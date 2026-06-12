const express = require('express');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

// Auto-detect base URL (Railway sets RAILWAY_PUBLIC_DOMAIN)
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.BASE_URL || `http://localhost:${PORT}`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── State (no seed/mock data) ────────────────────────────────────────────────
const state = {
  platforms: {
    linkedin:  { connected: false, account: null, token: null },
    instagram: { connected: false, account: null, token: null },
    facebook:  { connected: false, account: null, token: null }
  },
  posts: [],
  notifications: [],
  oauthSessions: {},
  credentials: {
    openai:   process.env.OPENAI_API_KEY || '',
    linkedin: {
      clientId:    process.env.LINKEDIN_CLIENT_ID     || '',
      clientSecret:process.env.LINKEDIN_CLIENT_SECRET || '',
      redirectUri: process.env.LINKEDIN_REDIRECT_URI  || `${BASE_URL}/oauth/linkedin/callback`
    },
    facebook: {
      appId:       process.env.FACEBOOK_APP_ID        || '',
      appSecret:   process.env.FACEBOOK_APP_SECRET    || '',
      redirectUri: process.env.FACEBOOK_REDIRECT_URI  || `${BASE_URL}/oauth/facebook/callback`
    }
  }
};

// ─── OpenAI ───────────────────────────────────────────────────────────────────
let _ai = null, _aiKey = null;

function getOpenAI() {
  const key = state.credentials.openai;
  if (!key) return null;
  if (!_ai || _aiKey !== key) { _ai = new OpenAI({ apiKey: key }); _aiKey = key; }
  return _ai;
}

const BRAND = `You are the AI social media strategist for TekyDoct Sdn Bhd — Brunei's #1 Zoho Premium Partner since 2006.
Core services: Zoho CRM, Zoho One, Zoho Books, Zoho Campaigns, IP CCTV & Surveillance, Structured Cabling, WiFi 6, Digital Transformation, IT Procurement.
Audience: Brunei SMEs, corporations, government-linked companies. 150+ clients served.
Brand voice: Professional, locally aware, data-driven, solution-focused. Always reference Brunei context when relevant.`;

async function gpt(messages, opts = {}) {
  const ai = getOpenAI();
  if (!ai) throw new Error('OpenAI API key not configured. Add it in Settings.');
  const res = await ai.chat.completions.create({ model: 'gpt-4o-mini', messages, temperature: 0.8, ...opts });
  return res.choices[0].message.content.trim();
}

// ─── Popup Close Helper ───────────────────────────────────────────────────────
function popupMsg(platform, success, extra = {}) {
  const msg = success ? { type: 'oauth_success', platform, ...extra } : { type: 'oauth_cancel', platform };
  return `<!DOCTYPE html><html><head><title>Connecting...</title></head><body>
<p style="font-family:sans-serif;text-align:center;padding:40px;color:#555;">
  ${success ? '✅ Connected successfully! Closing...' : '❌ Connection cancelled. Closing...'}
</p>
<script>
  try { window.opener && window.opener.postMessage(${JSON.stringify(msg)}, '*'); } catch(e){}
  setTimeout(() => window.close(), 800);
</script></body></html>`;
}

// ─── Status ───────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json({
  status: 'ok', version: '2.0.0',
  aiActive: !!getOpenAI(),
  connectedPlatforms: Object.entries(state.platforms).filter(([,v]) => v.connected).map(([k]) => k),
  timestamp: new Date().toISOString()
}));

app.get('/api/ai/status', (req, res) => res.json({ active: !!getOpenAI(), model: 'gpt-4o-mini' }));

// ─── Platforms ────────────────────────────────────────────────────────────────
app.get('/api/platforms', (req, res) => {
  const out = {};
  for (const [k, v] of Object.entries(state.platforms)) out[k] = { connected: v.connected, account: v.connected ? v.account : null };
  res.json(out);
});

// ─── LinkedIn OAuth ───────────────────────────────────────────────────────────
app.get('/api/oauth/linkedin/start', (req, res) => {
  const { clientId, redirectUri } = state.credentials.linkedin;
  if (!clientId) return res.json({ url: '/oauth/linkedin.html?setup=1', demo: true });
  const sid = crypto.randomBytes(8).toString('hex');
  state.oauthSessions[sid] = { platform: 'linkedin', ts: Date.now() };
  const p = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    state: sid, scope: 'r_liteprofile r_emailaddress w_member_social r_organization_social'
  });
  res.json({ url: `https://www.linkedin.com/oauth/v2/authorization?${p}`, demo: false });
});

app.get('/oauth/linkedin/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.send(popupMsg('linkedin', false));
  try {
    const { clientId, clientSecret, redirectUri } = state.credentials.linkedin;
    const tRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }).toString()
    });
    const tData = await tRes.json();
    if (!tData.access_token) throw new Error('No token: ' + JSON.stringify(tData));

    const pRes = await fetch('https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,vanityName)', {
      headers: { Authorization: `Bearer ${tData.access_token}` }
    });
    const profile = await pRes.json();

    let followers = 0;
    try {
      const fRes = await fetch(`https://api.linkedin.com/v2/networkSizes/urn:li:person:${profile.id}?edgeType=CompanyFollowedByMember`, { headers: { Authorization: `Bearer ${tData.access_token}` } });
      const fData = await fRes.json();
      followers = fData.firstDegreeSize || 0;
    } catch(e) {}

    const account = {
      id: profile.id,
      name: `${profile.localizedFirstName} ${profile.localizedLastName}`,
      handle: profile.vanityName || 'linkedin',
      followers,
      avatar: ((profile.localizedFirstName||'U')[0] + (profile.localizedLastName||'N')[0]).toUpperCase()
    };
    state.platforms.linkedin = { connected: true, account, token: tData.access_token };
    state.notifications.unshift({ id: 'n'+Date.now(), type: 'success', message: `LinkedIn "${account.name}" connected`, time: new Date().toISOString(), read: false });
    broadcastSSE({type:'connect',platform:'linkedin',msg:`LinkedIn account "${account.name}" connected`,icon:'🔗'});
    res.send(popupMsg('linkedin', true, { account }));
  } catch(e) {
    console.error('LinkedIn callback error:', e.message);
    res.send(popupMsg('linkedin', false));
  }
});

// ─── Facebook + Instagram OAuth ───────────────────────────────────────────────
app.get('/api/oauth/facebook/start', (req, res) => {
  const { appId, redirectUri } = state.credentials.facebook;
  if (!appId) return res.json({ url: '/oauth/facebook.html?setup=1', demo: true });
  const sid = crypto.randomBytes(8).toString('hex');
  const p = new URLSearchParams({
    client_id: appId, redirect_uri: redirectUri, state: sid,
    scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,pages_read_user_content,instagram_basic,instagram_content_publish,instagram_manage_insights,public_profile'
  });
  res.json({ url: `https://www.facebook.com/v18.0/dialog/oauth?${p}`, demo: false });
});

app.get('/oauth/facebook/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.send(popupMsg('facebook', false));
  try {
    const { appId, appSecret, redirectUri } = state.credentials.facebook;
    const tRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`);
    const tData = await tRes.json();
    if (!tData.access_token) throw new Error('No token');

    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${tData.access_token}`);
    const pagesData = await pagesRes.json();
    const page = pagesData.data?.[0];
    if (!page) throw new Error('No Facebook Pages found for this account');

    const pgRes = await fetch(`https://graph.facebook.com/v18.0/${page.id}?fields=name,fan_count,category,instagram_business_account&access_token=${page.access_token}`);
    const pg = await pgRes.json();

    const fbAccount = {
      id: page.id, name: pg.name || page.name, handle: pg.name || page.name,
      followers: pg.fan_count || 0, pageCategory: pg.category || 'Business',
      avatar: (pg.name || 'FB')[0].toUpperCase(), pageToken: page.access_token
    };
    state.platforms.facebook = { connected: true, account: fbAccount, token: page.access_token };
    state.notifications.unshift({ id: 'n'+Date.now(), type: 'success', message: `Facebook Page "${fbAccount.name}" connected`, time: new Date().toISOString(), read: false });
    broadcastSSE({type:'connect',platform:'facebook',msg:`Facebook Page "${fbAccount.name}" connected`,icon:'🔗'});

    // Auto-connect linked Instagram Business Account
    if (pg.instagram_business_account?.id) {
      const igRes = await fetch(`https://graph.facebook.com/v18.0/${pg.instagram_business_account.id}?fields=name,username,followers_count,biography&access_token=${page.access_token}`);
      const ig = await igRes.json();
      const igAccount = {
        id: pg.instagram_business_account.id, name: ig.name || 'Instagram',
        handle: `@${ig.username || 'instagram'}`, followers: ig.followers_count || 0,
        bio: ig.biography || '', avatar: (ig.username || 'IG')[0].toUpperCase()
      };
      state.platforms.instagram = { connected: true, account: igAccount, token: page.access_token };
      state.notifications.unshift({ id: 'n'+Date.now(), type: 'success', message: `Instagram @${ig.username} connected automatically`, time: new Date().toISOString(), read: false });
    }

    res.send(popupMsg('facebook', true, { account: fbAccount }));
  } catch(e) {
    console.error('Facebook callback error:', e.message);
    res.send(popupMsg('facebook', false));
  }
});

// Instagram uses Facebook App OAuth
app.get('/api/oauth/instagram/start', (req, res) => {
  const { appId, redirectUri } = state.credentials.facebook;
  if (!appId) return res.json({ url: '/oauth/instagram.html?setup=1', demo: true });
  const sid = crypto.randomBytes(8).toString('hex');
  const p = new URLSearchParams({
    client_id: appId, redirect_uri: redirectUri, state: sid,
    scope: 'instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement,public_profile'
  });
  res.json({ url: `https://www.facebook.com/v18.0/dialog/oauth?${p}`, demo: false });
});

app.post('/api/oauth/:platform/disconnect', (req, res) => {
  const { platform } = req.params;
  const name = state.platforms[platform]?.account?.name || platform;
  state.platforms[platform] = { connected: false, account: null, token: null };
  if (platform === 'facebook') state.platforms.instagram = { connected: false, account: null, token: null };
  state.notifications.unshift({ id: 'n'+Date.now(), type: 'info', message: `${platform} "${name}" disconnected`, time: new Date().toISOString(), read: false });
  res.json({ success: true });
});

// ─── Posts — real publish when connected ──────────────────────────────────────
app.get('/api/posts', (req, res) => {
  let posts = [...state.posts];
  if (req.query.status) posts = posts.filter(p => p.status === req.query.status);
  if (req.query.platform) posts = posts.filter(p => p.platform === req.query.platform);
  posts.sort((a, b) => (b.scheduledAt||b.publishedAt||b.createdAt||'').localeCompare(a.scheduledAt||a.publishedAt||a.createdAt||''));
  res.json(posts);
});

app.post('/api/posts', async (req, res) => {
  const { platform, content, scheduledAt } = req.body;
  if (!platform || !content) return res.status(400).json({ error: 'platform and content required' });
  const post = {
    id: 'p'+Date.now(), platform, content, scheduledAt: scheduledAt||null,
    publishedAt: null, status: scheduledAt ? 'scheduled' : 'draft',
    engagement: null, image: null, createdAt: new Date().toISOString()
  };

  // Publish immediately if platform is connected and no schedule time
  if (state.platforms[platform].connected && !scheduledAt) {
    try {
      const token = state.platforms[platform].token;
      if (platform === 'linkedin') {
        const lRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
          body: JSON.stringify({
            author: `urn:li:person:${state.platforms.linkedin.account.id}`,
            lifecycleState: 'PUBLISHED',
            specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: content }, shareMediaCategory: 'NONE' } },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
          })
        });
        if (lRes.ok) { post.status = 'published'; post.publishedAt = new Date().toISOString(); }
      } else if (platform === 'facebook') {
        const pgId = state.platforms.facebook.account.id;
        const pgToken = state.platforms.facebook.account.pageToken;
        const fRes = await fetch(`https://graph.facebook.com/v18.0/${pgId}/feed`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content, access_token: pgToken })
        });
        if (fRes.ok) { post.status = 'published'; post.publishedAt = new Date().toISOString(); }
      } else if (platform === 'instagram') {
        const igId = state.platforms.instagram.account.id;
        const igToken = state.platforms.instagram.token;
        const cRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caption: content, media_type: 'TEXT', access_token: igToken })
        });
        const cData = await cRes.json();
        if (cData.id) {
          const pRes = await fetch(`https://graph.facebook.com/v18.0/${igId}/media_publish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: cData.id, access_token: igToken })
          });
          if (pRes.ok) { post.status = 'published'; post.publishedAt = new Date().toISOString(); }
        }
      }
    } catch(e) { console.error(`Publish error [${platform}]:`, e.message); }
  }

  state.posts.unshift(post);
  state.notifications.unshift({ id: 'n'+Date.now(), type: 'success', message: `Post ${post.status} on ${platform}`, time: new Date().toISOString(), read: false });
  if (post.status === 'published') broadcastSSE({type:'publish',platform,msg:`Post published on ${platform}: "${content.slice(0,60)}..."`,icon:'✅'});
  res.json(post);
});

app.put('/api/posts/:id', (req, res) => {
  const p = state.posts.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  Object.assign(p, req.body); res.json(p);
});

app.delete('/api/posts/:id', (req, res) => {
  const i = state.posts.findIndex(p => p.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  state.posts.splice(i, 1); res.json({ success: true });
});

// ─── Notifications ────────────────────────────────────────────────────────────
app.get('/api/notifications', (req, res) => res.json(state.notifications.slice(0, 20)));
app.post('/api/notifications/read-all', (req, res) => { state.notifications.forEach(n => n.read = true); res.json({ success: true }); });

// ─── AI Caption — GPT only ────────────────────────────────────────────────────
app.post('/api/ai/generate', async (req, res) => {
  const { topic, platform, tone = 'professional' } = req.body;
  try {
    const guide = {
      linkedin: '150-250 words, professional, data-driven, include one relevant stat if possible, 3-5 hashtags at the end',
      instagram: '80-120 words, energetic, 2-3 emojis max, include CTA ("DM us" or "Link in bio"), 8-12 hashtags at end',
      facebook: '100-150 words, conversational, community-focused, end with a question or CTA, 3-5 hashtags'
    };
    const caption = await gpt([
      { role: 'system', content: BRAND },
      { role: 'user', content: `Write a ${platform} post about "${topic}" in a ${tone} tone.\nRequirements: ${guide[platform]||guide.linkedin}\nReturn ONLY the caption text with hashtags. No labels, no quotes, no preamble.` }
    ], { max_tokens: 450 });

    const followers = state.platforms[platform]?.account?.followers || 0;
    const recentPosts = state.posts.filter(p=>p.platform===platform&&p.status==='published');
    const avgEng = recentPosts.length
      ? (recentPosts.reduce((a,p)=>{const e=p.engagement;return a+(e&&e.reach>0?(e.likes+e.comments+e.shares)/e.reach*100:0);},0)/recentPosts.length).toFixed(1)
      : null;
    res.json({
      caption,
      hashtags: (caption.match(/#\w+/g)||[]).slice(0,12),
      estimatedReach: followers ? Math.round(followers * 0.08) : null,
      bestTime: platform==='linkedin'?'Tue–Thu 9–11 AM BST':platform==='instagram'?'Mon/Wed/Fri 11AM–6PM BST':'Wed 1PM or Fri 2PM BST',
      engagementScore: avgEng,
      aiPowered: true
    });
  } catch(e) {
    res.status(503).json({ error: e.message });
  }
});

// ─── Brand Health ─────────────────────────────────────────────────────────────
function brandHealth() {
  const cutoff = new Date(Date.now()-30*86400000);
  const details = {};
  let totalScore = 0, connectedCount = 0;
  for (const p of ['linkedin','instagram','facebook']) {
    const connected = state.platforms[p].connected;
    const followers = state.platforms[p].account?.followers || 0;
    if (!connected) {
      details[p] = { score:0, connected:false, followers:0, engagementRate:'0.0', postCount:0, status:'not_connected' };
      continue;
    }
    connectedCount++;
    const allPosts = state.posts.filter(x=>x.platform===p&&x.status==='published');
    const recentPosts = allPosts.filter(x=>x.publishedAt&&new Date(x.publishedAt)>=cutoff);
    const postFreq = recentPosts.length;
    const withEng = recentPosts.filter(x=>x.engagement?.reach>0);
    const engRate = withEng.length
      ? (withEng.reduce((a,x)=>{const e=x.engagement;return a+(e.likes+e.comments+e.shares)/e.reach*100;},0)/withEng.length)
      : 0;
    // Score: 40 base for connected + up to 30 for post frequency (target 8/mo) + up to 30 for engagement (target 4%)
    const score = Math.min(Math.round(40 + Math.min(postFreq/8*30,30) + Math.min(engRate/4*30,30)), 100);
    totalScore += score;
    details[p] = {
      score, connected, followers,
      engagementRate: engRate.toFixed(1),
      postCount: allPosts.length,
      status: score>=75?'healthy':score>=50?'moderate':'needs_attention'
    };
  }
  const overall = connectedCount > 0 ? Math.round(totalScore/connectedCount) : 0;
  return { overall, platforms: details, computedAt: new Date().toISOString() };
}

app.get('/api/brand-health', (req, res) => res.json(brandHealth()));

app.get('/api/brand-health/insights', async (req, res) => {
  const health = brandHealth();
  try {
    const connected = Object.entries(health.platforms).filter(([,v])=>v.connected).map(([k])=>k);
    const insights = await gpt([
      { role: 'system', content: BRAND },
      { role: 'user', content: `TekyDoct brand health: LinkedIn ${health.platforms.linkedin.score}/100, Instagram ${health.platforms.instagram.score}/100, Facebook ${health.platforms.facebook.score}/100. Connected: ${connected.join(', ')||'none'}. Total posts: ${state.posts.length}.\nGive 3 specific, actionable recommendations to improve the weakest platform. 3 bullet points, max 100 words.` }
    ], { max_tokens: 200 });
    res.json({ insights, health, aiPowered: true });
  } catch(e) { res.json({ insights: null, health, aiPowered: false, error: e.message }); }
});

// ─── Trending Topics — GPT powered, 1hr cache ─────────────────────────────────
const trendCache = { data: null, ts: 0 };
app.get('/api/trends', async (req, res) => {
  if (trendCache.data && Date.now() - trendCache.ts < 3600000) return res.json(trendCache.data);
  try {
    const raw = await gpt([
      { role: 'system', content: BRAND },
      { role: 'user', content: `List 10 trending topics in 2025-2026 most relevant to TekyDoct (Zoho ecosystem, IT infrastructure, CCTV/security, Brunei digital economy, SME automation, networking, cybersecurity).\nReturn JSON: {"trends":[{"id":"t1","topic":"name","category":"zoho/technology/security/local/networking","heat":"hot/rising/warm","relevance":95,"volume":"+XX%","description":"one sentence why trending and relevant to TekyDoct"}]}` }
    ], { max_tokens: 900, response_format: { type: 'json_object' } });
    const parsed = JSON.parse(raw);
    trendCache.data = { trends: parsed.trends, updatedAt: new Date().toISOString(), aiPowered: true };
    trendCache.ts = Date.now();
    res.json(trendCache.data);
  } catch(e) {
    res.status(503).json({ error: e.message });
  }
});

// ─── Analytics — real data only ───────────────────────────────────────────────
function analyticsEstimate(platform, period) {
  const days = period==='7d'?7:period==='30d'?30:90;
  const labels=[],reach=[],engagement=[],clicks=[];
  for (let i=days-1;i>=0;i--) {
    const d = new Date(Date.now()-i*86400000);
    const dateStr = d.toISOString().split('T')[0];
    labels.push(d.toLocaleDateString('en-GB',{month:'short',day:'numeric'}));
    const dayPosts = state.posts.filter(p=>p.platform===platform&&p.status==='published'&&p.publishedAt?.startsWith(dateStr));
    const r = dayPosts.reduce((a,p)=>a+(p.engagement?.reach||0),0);
    const c = dayPosts.reduce((a,p)=>a+(p.engagement?.clicks||0),0);
    const withEng = dayPosts.filter(p=>p.engagement?.reach>0);
    const e = withEng.length
      ? (withEng.reduce((a,p)=>{const en=p.engagement;return a+(en.likes+en.comments+en.shares)/en.reach*100;},0)/withEng.length).toFixed(1)
      : '0.0';
    reach.push(r); engagement.push(e); clicks.push(c);
  }
  const published = state.posts.filter(p=>p.platform===platform&&p.status==='published');
  const engArr = engagement.map(parseFloat).filter(v=>v>0);
  const totals = {
    reach: reach.reduce((a,b)=>a+b,0),
    engagement: engArr.length ? (engArr.reduce((a,b)=>a+b,0)/engArr.length).toFixed(1) : '0.0',
    clicks: clicks.reduce((a,b)=>a+b,0),
    posts: published.filter(p=>new Date(p.publishedAt)>=new Date(Date.now()-days*86400000)).length,
    followers: state.platforms[platform]?.account?.followers||0
  };
  return { labels, datasets:{reach,engagement,clicks}, totals };
}

app.get('/api/analytics', (req, res) => {
  const { platform='all', period='30d' } = req.query;
  if (platform==='all') {
    const result = {};
    for (const p of ['linkedin','instagram','facebook']) result[p] = analyticsEstimate(p, period);
    const c = {reach:0,engagement:0,clicks:0,posts:0,followers:0};
    for (const d of Object.values(result)) { c.reach+=d.totals.reach; c.engagement+=parseFloat(d.totals.engagement); c.clicks+=d.totals.clicks; c.posts+=d.totals.posts; c.followers+=d.totals.followers; }
    c.engagement = (c.engagement/3).toFixed(1);
    result.combined = c;
    return res.json(result);
  }
  res.json(analyticsEstimate(platform, period));
});

// ─── Smart Planner: Weekly — GPT only ────────────────────────────────────────
app.get('/api/planner/weekly', async (req, res) => {
  const offset = parseInt(req.query.offset||'0');
  const today = new Date();
  const mon = new Date(today);
  mon.setDate(today.getDate()-((today.getDay()+6)%7)+offset*7);
  mon.setHours(0,0,0,0);
  const dates = Array.from({length:7},(_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return d.toISOString().split('T')[0];});
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const health = brandHealth();
  const connected = Object.entries(state.platforms).filter(([,v])=>v.connected).map(([k])=>k);
  const platforms = connected.length ? connected : ['linkedin','instagram','facebook'];

  try {
    const prompt = `Generate a complete 7-day social media content plan for TekyDoct. Week starting ${dates[0]}.
Brand health — LinkedIn: ${health.platforms.linkedin.score}/100, Instagram: ${health.platforms.instagram.score}/100, Facebook: ${health.platforms.facebook.score}/100.
Active platforms: ${platforms.join(', ')}.

Posting schedule:
- Monday: linkedin + instagram
- Tuesday: linkedin
- Wednesday: facebook + instagram
- Thursday: linkedin
- Friday: facebook + instagram
- Saturday: instagram
- Sunday: rest (empty posts array)

Best posting times: LinkedIn 09:00 BST, Instagram 11:00 or 18:00 BST, Facebook 13:00 BST.

Write COMPLETE publish-ready captions. Each must be full length, platform-appropriate, with hashtags. Cover different topics: Zoho CRM, CCTV Security, Networking, Digital Transformation, client success.

Return ONLY valid JSON:
{"plan":[{"day":"Monday","date":"${dates[0]}","posts":[{"platform":"linkedin","time":"09:00","caption":"FULL CAPTION WITH HASHTAGS HERE","hashtags":["#TekyDoct","#Brunei"],"predictedReach":1200,"predictedEngagement":"4.2","trend":"Zoho CRM"}]}]}`;

    const raw = await gpt([
      { role: 'system', content: BRAND },
      { role: 'user', content: prompt }
    ], { max_tokens: 4500, temperature: 0.75, response_format: { type: 'json_object' } });

    const parsed = JSON.parse(raw);
    const fullPlan = days.map((day,i) => (parsed.plan||[]).find(d=>d.day===day) || {day,date:dates[i],posts:[]});
    res.json({ weekOf:dates[0], generatedAt:new Date().toISOString(), aiPowered:true, brandHealthSnapshot:{overall:health.overall,linkedin:health.platforms.linkedin.score,instagram:health.platforms.instagram.score,facebook:health.platforms.facebook.score}, totalPosts:fullPlan.reduce((a,d)=>a+d.posts.length,0), plan:fullPlan });
  } catch(e) {
    res.status(503).json({ error: e.message });
  }
});

app.post('/api/planner/weekly/push', (req, res) => {
  const { posts } = req.body;
  let added = 0;
  for (const p of (posts||[])) {
    if (!p.caption||!p.platform) continue;
    const dt = p.date&&p.time ? new Date(p.date+'T'+p.time+':00') : new Date();
    state.posts.unshift({id:'p'+Date.now()+added,platform:p.platform,content:p.caption,scheduledAt:dt.toISOString(),publishedAt:null,status:'scheduled',engagement:null,image:null,createdAt:new Date().toISOString()});
    added++;
  }
  state.notifications.unshift({id:'n'+Date.now(),type:'success',message:`${added} posts from Smart Planner added to schedule`,time:new Date().toISOString(),read:false});
  res.json({ success:true, added });
});

// ─── Monthly Plan ─────────────────────────────────────────────────────────────
app.get('/api/planner/monthly', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year||now.getFullYear());
  const month = parseInt(req.query.month??now.getMonth());
  const themes = [
    {week:1,theme:'Zoho Product Spotlight',color:'#7c3aed',icon:'🔮',focus:'Zoho CRM, Zoho One, Zoho Books features and client wins'},
    {week:2,theme:'Security & Infrastructure',color:'#0077b5',icon:'🔒',focus:'CCTV, networking, structured cabling, access control'},
    {week:3,theme:'Digital Transformation',color:'#ec4899',icon:'🚀',focus:'Client success stories, digital journeys, case studies'},
    {week:4,theme:'Community & Brand',color:'#10b981',icon:'🌟',focus:'Team highlights, company milestones, Brunei tech community'}
  ];
  const firstDay = new Date(year,month,1);
  const lastDay = new Date(year,month+1,0);
  const calendar = {};
  for (let d=1;d<=lastDay.getDate();d++) {
    const date = new Date(year,month,d);
    const dow = date.getDay();
    const weekNum = Math.ceil((d+((firstDay.getDay()+6)%7))/7);
    const theme = themes[Math.min(weekNum-1,3)];
    const plats = [1,2,4].includes(dow)?['linkedin']:[3].includes(dow)?['instagram','facebook']:[5].includes(dow)?['instagram']:[];
    calendar[d] = { date:date.toISOString().split('T')[0], theme:theme.theme, themeColor:theme.color, themeIcon:theme.icon, posts:plats.map(pl=>({platform:pl,time:{linkedin:'09:00',instagram:'11:00',facebook:'13:00'}[pl],predictedReach:state.platforms[pl]?.account?.followers?Math.round(state.platforms[pl].account.followers*0.08):null})) };
  }
  res.json({ year, month, monthName:new Date(year,month,1).toLocaleString('en-GB',{month:'long',year:'numeric'}), themes, calendar, totalPostDays:Object.values(calendar).filter(d=>d.posts?.length>0).length, aiPowered:!!getOpenAI() });
});

// ─── Settings / Credentials ───────────────────────────────────────────────────
app.get('/api/settings/credentials', (req, res) => res.json({
  openai:   { configured: !!state.credentials.openai },
  linkedin: { configured: !!state.credentials.linkedin.clientId, redirectUri: state.credentials.linkedin.redirectUri },
  facebook: { configured: !!state.credentials.facebook.appId,    redirectUri: state.credentials.facebook.redirectUri }
}));

app.post('/api/settings/credentials', (req, res) => {
  const { platform, apiKey, clientId, clientSecret, appId, appSecret } = req.body;
  if (platform==='openai') {
    state.credentials.openai = apiKey||''; _ai=null;
    return res.json({ success:true, aiActive:!!state.credentials.openai });
  }
  if (platform==='linkedin') { if(clientId) state.credentials.linkedin.clientId=clientId; if(clientSecret) state.credentials.linkedin.clientSecret=clientSecret; }
  if (platform==='facebook'||platform==='instagram') { if(appId) state.credentials.facebook.appId=appId; if(appSecret) state.credentials.facebook.appSecret=appSecret; }
  state.notifications.unshift({id:'n'+Date.now(),type:'success',message:`${platform} credentials saved`,time:new Date().toISOString(),read:false});
  res.json({ success:true });
});

// ─── SSE Monitoring — real notifications only ─────────────────────────────────
const sseClients = new Set();
app.get('/api/monitoring/stream', (req, res) => {
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders();
  // Send connected platforms status on connect
  const connected = Object.entries(state.platforms).filter(([,v])=>v.connected).map(([k])=>k);
  res.write(`data: ${JSON.stringify({type:'connected',msg:connected.length?`Monitoring ${connected.join(', ')} — waiting for activity`:'No platforms connected yet. Link accounts to start monitoring.',icon:'📡',id:'init',timestamp:new Date().toISOString()})}\n\n`);
  sseClients.add(res);
  req.on('close',()=>sseClients.delete(res));
});

function broadcastSSE(event) {
  const data = `data: ${JSON.stringify({...event,id:'e'+Date.now(),timestamp:new Date().toISOString()})}\n\n`;
  for (const client of sseClients) { try { client.write(data); } catch(_) { sseClients.delete(client); } }
}

// ─── SPA ──────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, () => {
  console.log(`\n✅ TekyDoct Social Planner v2.0 — http://localhost:${PORT}`);
  console.log(`   AI (GPT-4o-mini): ${getOpenAI() ? '✅ Active' : '❌ Add OPENAI_API_KEY'}`);
  console.log(`   LinkedIn OAuth:   ${state.credentials.linkedin.clientId ? '✅ Configured' : '⚠️  Add LINKEDIN_CLIENT_ID + SECRET'}`);
  console.log(`   Facebook OAuth:   ${state.credentials.facebook.appId ? '✅ Configured' : '⚠️  Add FACEBOOK_APP_ID + SECRET'}`);
  console.log(`   Press Ctrl+C to stop\n`);
});
