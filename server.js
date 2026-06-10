const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-Memory State ───────────────────────────────────────────────────────────
const state = {
  platforms: {
    linkedin: { connected: false, account: null, token: null },
    instagram: { connected: false, account: null, token: null },
    facebook: { connected: false, account: null, token: null }
  },
  posts: [],
  notifications: [],
  oauthSessions: {}
};

// Seed some initial posts
const seedPosts = [
  {
    id: 'p1', platform: 'linkedin', status: 'published',
    content: '🚀 Excited to announce TekyDoct is now Brunei\'s #1 Zoho Premium Partner! Our team has helped 150+ businesses transform digitally. Ready to start your journey? #ZohoPartner #DigitalTransformation #Brunei',
    scheduledAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    publishedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    engagement: { likes: 87, comments: 14, shares: 23, reach: 1240 },
    image: null
  },
  {
    id: 'p2', platform: 'instagram', status: 'published',
    content: '🔒 Your security is our priority. From IP cameras to full NVR setups — TekyDoct CCTV solutions keep your business protected 24/7. DM us for a free site assessment! #CCTV #SecurityCamera #Brunei #TechSolution',
    scheduledAt: new Date(Date.now() - 86400000).toISOString(),
    publishedAt: new Date(Date.now() - 86400000).toISOString(),
    engagement: { likes: 134, comments: 8, shares: 5, reach: 2100 },
    image: null
  },
  {
    id: 'p3', platform: 'facebook', status: 'published',
    content: 'Did you know? Businesses using Zoho CRM see a 29% increase in sales on average. TekyDoct is here to implement and customise Zoho for your industry. 📊 Book a free demo today!',
    scheduledAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    publishedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    engagement: { likes: 45, comments: 6, shares: 12, reach: 890 },
    image: null
  },
  {
    id: 'p4', platform: 'linkedin', status: 'scheduled',
    content: '🌐 Thinking of upgrading your office network? TekyDoct\'s structured cabling and WiFi solutions deliver enterprise-grade connectivity for businesses of all sizes in Brunei. Let\'s talk infrastructure. #Networking #IT #Brunei',
    scheduledAt: new Date(Date.now() + 3600000 * 3).toISOString(),
    publishedAt: null,
    engagement: null,
    image: null
  },
  {
    id: 'p5', platform: 'instagram', status: 'scheduled',
    content: '✨ Transform the way your team works with Zoho One — 45+ integrated apps in one platform. TekyDoct sets it all up for you. #ZohoOne #ProductivityTools #SmallBusiness',
    scheduledAt: new Date(Date.now() + 3600000 * 8).toISOString(),
    publishedAt: null,
    engagement: null,
    image: null
  },
  {
    id: 'p6', platform: 'facebook', status: 'draft',
    content: 'Join our upcoming free webinar: "How to Automate Your Business with Zoho" — Thursday, 19 June at 2PM BST. Register now via the link in bio!',
    scheduledAt: null,
    publishedAt: null,
    engagement: null,
    image: null
  }
];
state.posts = seedPosts;

const seedNotifications = [
  { id: 'n1', type: 'success', message: 'LinkedIn post published successfully', time: new Date(Date.now() - 3600000 * 2).toISOString(), read: false },
  { id: 'n2', type: 'info', message: 'Instagram post scheduled for 6:00 PM today', time: new Date(Date.now() - 3600000).toISOString(), read: false },
  { id: 'n3', type: 'warning', message: 'Facebook engagement lower than usual this week', time: new Date(Date.now() - 1800000).toISOString(), read: true }
];
state.notifications = seedNotifications;

// ─── Mock Account Data ─────────────────────────────────────────────────────────
const mockAccounts = {
  linkedin: {
    id: 'li_tekydoct_' + Date.now(),
    name: 'TekyDoct Sdn Bhd',
    handle: 'tekydoct',
    avatar: 'TD',
    followers: 2847,
    following: 312,
    profileUrl: 'https://linkedin.com/company/tekydoct',
    industry: 'Information Technology',
    location: 'Brunei Darussalam',
    verified: true
  },
  instagram: {
    id: 'ig_tekydoct_' + Date.now(),
    name: 'TekyDoct',
    handle: '@tekydoct',
    avatar: 'TD',
    followers: 1234,
    following: 189,
    profileUrl: 'https://instagram.com/tekydoct',
    bio: 'Brunei #1 Zoho Partner | IT Solutions | CCTV & Security',
    verified: false
  },
  facebook: {
    id: 'fb_tekydoct_' + Date.now(),
    name: 'TekyDoct Sdn Bhd',
    handle: 'TekyDoct',
    avatar: 'TD',
    followers: 3421,
    following: 0,
    profileUrl: 'https://facebook.com/tekydoct',
    pageCategory: 'Technology Company',
    verified: true
  }
};

// ─── Analytics Mock Data ───────────────────────────────────────────────────────
function generateAnalytics(platform, period) {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const baseReach = { linkedin: 1200, instagram: 2000, facebook: 900 };
  const base = baseReach[platform] || 1200;
  const labels = [];
  const reach = [], engagement = [], clicks = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    labels.push(d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }));
    reach.push(Math.round(base + (Math.random() - 0.4) * base * 0.3));
    engagement.push(Math.round((Math.random() * 5 + 2) * 10) / 10);
    clicks.push(Math.round(Math.random() * 80 + 20));
  }
  const totals = {
    reach: reach.reduce((a, b) => a + b, 0),
    engagement: (engagement.reduce((a, b) => a + b, 0) / engagement.length).toFixed(1),
    clicks: clicks.reduce((a, b) => a + b, 0),
    posts: state.posts.filter(p => p.platform === platform && p.status === 'published').length,
    followers: mockAccounts[platform]?.followers || 0
  };
  return { labels, datasets: { reach, engagement, clicks }, totals };
}

// ─── AI Caption Templates ──────────────────────────────────────────────────────
const captionTemplates = {
  zoho_crm: {
    linkedin: [
      '📊 Sales teams using Zoho CRM close 29% more deals. TekyDoct helps businesses in Brunei implement, customise, and maximise Zoho CRM for their industry. Ready to scale? Let\'s talk. #ZohoCRM #SalesAutomation #Brunei',
      '🔗 Siloed data is costing your business. Zoho CRM unifies customer data, automates workflows, and gives your team a 360° view. TekyDoct — Brunei\'s certified Zoho implementation partner. #CRM #DigitalTransformation',
    ],
    instagram: [
      '💼 Your CRM should work as hard as you do. Zoho CRM + TekyDoct setup = sales on autopilot ✨ DM us today! #ZohoCRM #BusinessTech #Brunei',
      '📱 From lead to close — Zoho CRM tracks every step. Let TekyDoct set it up for your business! #CRM #Automation #SME',
    ],
    facebook: [
      'Still managing customers in spreadsheets? 😅 Zoho CRM automates follow-ups, tracks deals, and boosts your sales team\'s productivity. TekyDoct offers free CRM demos — contact us today!',
    ]
  },
  cctv_security: {
    linkedin: [
      '🔒 Physical security is part of your digital strategy. TekyDoct designs end-to-end CCTV and access control systems for commercial and industrial facilities across Brunei. #Security #CCTV #Infrastructure',
    ],
    instagram: [
      '👁️ Eyes on your business, always. Professional CCTV installation by TekyDoct — HD cameras, remote access, 24/7 monitoring. #CCTV #SecurityCamera #Brunei',
      '🏢 Protecting what matters most. TekyDoct CCTV solutions for offices, warehouses & retail spaces. #SafetyFirst #CCTVBrunei',
    ],
    facebook: [
      'Worried about security? TekyDoct installs professional CCTV systems with remote monitoring capabilities. Get a free site assessment — message us now! 📷',
    ]
  },
  networking: {
    linkedin: [
      '🌐 A slow network is a productivity killer. TekyDoct\'s enterprise networking solutions — structured cabling, managed switches, and WiFi 6 deployments — keep your business running at full speed. #Networking #IT #Brunei',
    ],
    instagram: [
      '⚡ Fast, reliable WiFi everywhere in your office. TekyDoct makes it happen! #WiFi #NetworkSolutions #TechBrunei',
    ],
    facebook: [
      'Tired of dead WiFi zones? TekyDoct designs and installs enterprise-grade networking for offices and warehouses across Brunei. Get a free network assessment!',
    ]
  },
  digital_transformation: {
    linkedin: [
      '🚀 Digital transformation isn\'t just a buzzword — it\'s survival. TekyDoct has helped 150+ businesses in Brunei modernise their operations with cloud solutions, automation, and smart infrastructure. Where are you on your journey? #DigitalTransformation #CloudSolutions',
    ],
    instagram: [
      '🌟 The future of business is digital. TekyDoct is your transformation partner in Brunei! #DigitalBrunei #TechSolutions #Innovation',
    ],
    facebook: [
      'Is your business ready for the digital age? TekyDoct offers end-to-end digital transformation consulting — from strategy to implementation. Let\'s build your future together.',
    ]
  }
};

// ─── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Get platform connection status
app.get('/api/platforms', (req, res) => {
  const result = {};
  for (const [name, data] of Object.entries(state.platforms)) {
    result[name] = {
      connected: data.connected,
      account: data.connected ? data.account : null
    };
  }
  res.json(result);
});

// Start OAuth flow — returns popup URL
app.get('/api/oauth/:platform/start', (req, res) => {
  const { platform } = req.params;
  if (!['linkedin', 'instagram', 'facebook'].includes(platform)) {
    return res.status(400).json({ error: 'Unknown platform' });
  }
  const sessionId = crypto.randomBytes(8).toString('hex');
  state.oauthSessions[sessionId] = { platform, createdAt: Date.now() };
  const url = `/oauth/${platform}.html?session=${sessionId}`;
  res.json({ url, sessionId });
});

// Complete OAuth — called by consent popup
app.post('/api/oauth/:platform/authorize', (req, res) => {
  const { platform } = req.params;
  const { sessionId } = req.body;
  if (!state.oauthSessions[sessionId]) {
    return res.status(400).json({ error: 'Invalid or expired session' });
  }
  delete state.oauthSessions[sessionId];
  const account = mockAccounts[platform];
  const token = 'mock_token_' + crypto.randomBytes(16).toString('hex');
  state.platforms[platform] = { connected: true, account, token };

  // Add notification
  state.notifications.unshift({
    id: 'n' + Date.now(),
    type: 'success',
    message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} account "${account.name}" connected successfully`,
    time: new Date().toISOString(),
    read: false
  });

  res.json({ success: true, account });
});

// Disconnect platform
app.post('/api/oauth/:platform/disconnect', (req, res) => {
  const { platform } = req.params;
  const accountName = state.platforms[platform]?.account?.name || platform;
  state.platforms[platform] = { connected: false, account: null, token: null };
  state.notifications.unshift({
    id: 'n' + Date.now(),
    type: 'info',
    message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} account "${accountName}" disconnected`,
    time: new Date().toISOString(),
    read: false
  });
  res.json({ success: true });
});

// Get posts
app.get('/api/posts', (req, res) => {
  let posts = [...state.posts];
  if (req.query.status) posts = posts.filter(p => p.status === req.query.status);
  if (req.query.platform) posts = posts.filter(p => p.platform === req.query.platform);
  posts.sort((a, b) => {
    const ta = a.scheduledAt || a.publishedAt || '';
    const tb = b.scheduledAt || b.publishedAt || '';
    return tb.localeCompare(ta);
  });
  res.json(posts);
});

// Create post
app.post('/api/posts', (req, res) => {
  const { platform, content, scheduledAt, image } = req.body;
  if (!platform || !content) return res.status(400).json({ error: 'platform and content required' });
  const post = {
    id: 'p' + Date.now(),
    platform,
    content,
    scheduledAt: scheduledAt || null,
    publishedAt: null,
    status: scheduledAt ? 'scheduled' : 'draft',
    engagement: null,
    image: image || null,
    createdAt: new Date().toISOString()
  };
  state.posts.unshift(post);
  state.notifications.unshift({
    id: 'n' + Date.now(),
    type: 'success',
    message: `Post ${post.status === 'scheduled' ? 'scheduled' : 'saved as draft'} for ${platform}`,
    time: new Date().toISOString(),
    read: false
  });
  res.json(post);
});

// Update post
app.put('/api/posts/:id', (req, res) => {
  const post = state.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  Object.assign(post, req.body);
  res.json(post);
});

// Delete post
app.delete('/api/posts/:id', (req, res) => {
  const idx = state.posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Post not found' });
  state.posts.splice(idx, 1);
  res.json({ success: true });
});

// Analytics
app.get('/api/analytics', (req, res) => {
  const { platform = 'all', period = '30d' } = req.query;
  if (platform === 'all') {
    const result = {};
    for (const p of ['linkedin', 'instagram', 'facebook']) {
      result[p] = generateAnalytics(p, period);
    }
    // Combined totals
    const combined = { reach: 0, engagement: 0, clicks: 0, posts: 0, followers: 0 };
    for (const d of Object.values(result)) {
      combined.reach += d.totals.reach;
      combined.engagement += parseFloat(d.totals.engagement);
      combined.clicks += d.totals.clicks;
      combined.posts += d.totals.posts;
      combined.followers += d.totals.followers;
    }
    combined.engagement = (combined.engagement / 3).toFixed(1);
    result.combined = combined;
    return res.json(result);
  }
  res.json(generateAnalytics(platform, period));
});

// Notifications
app.get('/api/notifications', (req, res) => {
  res.json(state.notifications.slice(0, 20));
});

app.post('/api/notifications/read-all', (req, res) => {
  state.notifications.forEach(n => n.read = true);
  res.json({ success: true });
});

// AI Caption Generation (simulated 1.5s latency)
app.post('/api/ai/generate', (req, res) => {
  const { topic, platform, tone } = req.body;
  setTimeout(() => {
    const topicKey = topic ? topic.toLowerCase().replace(/\s+/g, '_') : 'digital_transformation';
    const templateGroup = captionTemplates[topicKey] || captionTemplates['digital_transformation'];
    const platformTemplates = templateGroup[platform] || templateGroup['linkedin'] || [];
    let caption = platformTemplates[Math.floor(Math.random() * platformTemplates.length)];
    if (!caption) caption = `Exciting things are happening at TekyDoct! Stay tuned for updates on ${topic || 'our latest solutions'}. #TekyDoct #Brunei #Technology`;

    // Hashtag suggestions
    const hashtagMap = {
      linkedin: ['#TekyDoct', '#Brunei', '#DigitalTransformation', '#ZohoPartner', '#ITSolutions'],
      instagram: ['#TekyDoct', '#Brunei', '#TechLife', '#Innovation', '#BruneiTech', '#SME'],
      facebook: ['#TekyDoct', '#Brunei', '#Technology', '#BusinessSolutions']
    };
    const hashtags = hashtagMap[platform] || hashtagMap['linkedin'];

    res.json({
      caption,
      hashtags,
      estimatedReach: Math.round(Math.random() * 1500 + 500),
      bestTime: platform === 'linkedin' ? 'Tuesday–Thursday, 9–11 AM BST' : platform === 'instagram' ? 'Mon/Wed/Fri, 11AM–6PM BST' : 'Wednesday 1PM or Friday 2PM BST',
      engagementScore: Math.round(Math.random() * 3 + 6) / 10
    });
  }, 1500);
});

// SSE — Real-time monitoring stream
app.get('/api/monitoring/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const events = [
    { type: 'like', platform: 'linkedin', msg: 'Someone liked your LinkedIn post about Zoho CRM', icon: '👍' },
    { type: 'comment', platform: 'instagram', msg: 'New comment on your CCTV Instagram post', icon: '💬' },
    { type: 'share', platform: 'facebook', msg: 'Your Facebook post was shared 3 times', icon: '🔁' },
    { type: 'follow', platform: 'instagram', msg: 'You have 5 new Instagram followers', icon: '➕' },
    { type: 'mention', platform: 'linkedin', msg: 'TekyDoct was mentioned in a LinkedIn post', icon: '📢' },
    { type: 'click', platform: 'facebook', msg: '12 clicks on your Facebook link today', icon: '🖱️' },
    { type: 'reach', platform: 'instagram', msg: 'Your Instagram story reached 400 views', icon: '👁️' },
    { type: 'message', platform: 'facebook', msg: 'New inquiry message on Facebook Page', icon: '✉️' },
    { type: 'like', platform: 'instagram', msg: 'Your CCTV post hit 100 likes on Instagram', icon: '❤️' },
    { type: 'comment', platform: 'linkedin', msg: 'Someone commented: "Can you help with Zoho Books?"', icon: '💬' }
  ];

  const sendEvent = () => {
    const evt = events[Math.floor(Math.random() * events.length)];
    const data = JSON.stringify({
      ...evt,
      id: 'evt_' + Date.now(),
      timestamp: new Date().toISOString()
    });
    res.write(`data: ${data}\n\n`);
  };

  sendEvent(); // immediate first event
  const interval = setInterval(sendEvent, Math.random() * 8000 + 6000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// ─── Smart Planner: Brand Health ─────────────────────────────────────────────
function computeBrandHealth() {
  const publishedPosts = state.posts.filter(p => p.status === 'published');
  const platforms = ['linkedin', 'instagram', 'facebook'];
  const scores = {};
  const details = {};

  for (const p of platforms) {
    const pp = publishedPosts.filter(x => x.platform === p);
    const engAvg = pp.length ? pp.reduce((a, b) => a + (b.engagement ? (b.engagement.likes + b.engagement.comments * 2 + b.engagement.shares * 3) / (b.engagement.reach || 1) * 100 : 0), 0) / pp.length : 0;
    const freq = Math.min(pp.length / 10 * 100, 100);
    const acc = state.platforms[p];
    const followers = acc.connected && acc.account ? acc.account.followers : 0;
    const followerScore = Math.min(followers / 5000 * 100, 100);
    const base = { linkedin: 68, instagram: 61, facebook: 54 }[p];
    const score = Math.round(base + (Math.random() - 0.3) * 8);
    scores[p] = Math.min(Math.max(score, 40), 95);
    details[p] = {
      score: scores[p],
      engagementRate: (Math.random() * 3 + 2).toFixed(1),
      postFrequency: pp.length,
      followerGrowth: (Math.random() * 4 + 0.5).toFixed(1),
      contentQuality: Math.round(55 + Math.random() * 35),
      status: scores[p] >= 75 ? 'healthy' : scores[p] >= 55 ? 'moderate' : 'needs_attention',
      recommendations: getBrandRecs(p, scores[p])
    };
  }
  const overall = Math.round((scores.linkedin + scores.instagram + scores.facebook) / 3);
  return { overall, platforms: details, computedAt: new Date().toISOString() };
}

function getBrandRecs(platform, score) {
  const recs = {
    linkedin: [
      score < 70 ? 'Post 4–5x per week to improve visibility' : 'Maintain your current posting cadence',
      'Add more data-driven posts — stats perform 37% better on LinkedIn',
      'Engage with comments within the first hour of posting',
      'Use carousels and documents for higher reach',
    ],
    instagram: [
      score < 65 ? 'Increase Reels output — Reels get 3x more reach than static posts' : 'Your Reels strategy is working — continue',
      'Use 10–12 targeted hashtags per post',
      'Post Stories daily to stay top-of-feed',
      'Feature team or behind-the-scenes content to humanise the brand',
    ],
    facebook: [
      score < 60 ? 'Facebook engagement drops without consistent posting — aim for 3x/week' : 'Consistent posting is building your audience',
      'Add video content — Facebook prioritises native video',
      'Respond to all comments to boost algorithmic reach',
      'Run a monthly Q&A or live session to drive interaction',
    ]
  };
  return (recs[platform] || []).slice(0, 3);
}

app.get('/api/brand-health', (req, res) => {
  res.json(computeBrandHealth());
});

// ─── Smart Planner: Trending Topics ──────────────────────────────────────────
const trendBank = [
  { id: 'tr1', topic: 'AI-Powered CRM & Automation', category: 'technology', heat: 'hot', relevance: 96, volume: '+142%', description: 'Businesses seeking AI features inside CRM — Zoho\'s AI suite is trending' },
  { id: 'tr2', topic: 'Brunei Digital Economy Blueprint', category: 'local', heat: 'hot', relevance: 94, volume: '+118%', description: 'Government initiatives driving SME digital adoption across Brunei' },
  { id: 'tr3', topic: 'IP Surveillance & Smart Security', category: 'security', heat: 'hot', relevance: 91, volume: '+87%', description: 'Demand for IP cameras with remote monitoring at an all-time high' },
  { id: 'tr4', topic: 'Cloud Migration for SMEs', category: 'technology', heat: 'rising', relevance: 89, volume: '+74%', description: 'SMEs accelerating on-premise to cloud transitions post-pandemic' },
  { id: 'tr5', topic: 'Zoho One All-in-One Suite', category: 'zoho', heat: 'hot', relevance: 93, volume: '+105%', description: 'Growing demand for integrated business suites replacing point solutions' },
  { id: 'tr6', topic: 'WiFi 6 Office Upgrades', category: 'networking', heat: 'rising', relevance: 82, volume: '+61%', description: 'Enterprises upgrading to WiFi 6 ahead of hybrid work demands' },
  { id: 'tr7', topic: 'SME Cybersecurity Awareness', category: 'security', heat: 'rising', relevance: 85, volume: '+68%', description: 'Cyber attacks on SMEs up 300% — businesses seeking affordable solutions' },
  { id: 'tr8', topic: 'Business Process Automation', category: 'zoho', heat: 'warm', relevance: 88, volume: '+53%', description: 'Workflow automation reducing manual tasks — Zoho Flow & Creator leading' },
  { id: 'tr9', topic: 'Remote IT Support & MSP', category: 'technology', heat: 'warm', relevance: 78, volume: '+44%', description: 'Managed IT services growing as businesses outsource infrastructure' },
  { id: 'tr10', topic: 'Green IT & Sustainable Tech', category: 'technology', heat: 'rising', relevance: 71, volume: '+38%', description: 'Eco-conscious business tech purchasing on the rise in SEA' }
];

app.get('/api/trends', (req, res) => {
  // Shuffle slightly to simulate freshness
  const shuffled = [...trendBank].sort(() => Math.random() * 0.4 - 0.2);
  res.json({ trends: shuffled, updatedAt: new Date().toISOString() });
});

// ─── Smart Planner: Weekly Plan Generator ────────────────────────────────────
const plannerCaptions = {
  'AI-Powered CRM & Automation': {
    linkedin: '🤖 AI is transforming CRM — and TekyDoct is ahead of the curve. Zoho\'s built-in AI, Zia, predicts lead scores, automates follow-ups, and surfaces insights your team would miss. Brunei businesses using Zoho AI CRM report 34% faster deal closures. Ready to see it in action? #ZohoCRM #ArtificialIntelligence #SalesAutomation #Brunei',
    instagram: '🤖 Smart CRM = more closed deals ✨ Zoho\'s AI does the heavy lifting so your team can focus on what matters — building relationships. DM us for a free demo! #ZohoCRM #AITools #BusinessTech #Brunei',
    facebook: 'Did you know AI can predict which leads are most likely to convert? Zoho CRM\'s built-in AI (Zia) does exactly that. TekyDoct sets it up for Brunei businesses — ask us for a free walkthrough!'
  },
  'Brunei Digital Economy Blueprint': {
    linkedin: '🇧🇳 Brunei\'s Digital Economy Blueprint is creating real opportunities for businesses that act now. TekyDoct has been supporting Brunei\'s digital transformation journey since 2006 — from cloud adoption to smart infrastructure. Is your business ready? Let\'s build your roadmap. #BruneiDigital #DigitalTransformation #BDEB',
    instagram: '🌐 Brunei is going digital — is your business ready? TekyDoct has been powering Brunei businesses since 2006. Let\'s grow together 🚀 #DigitalBrunei #BDEB #TechSolutions #BruneiTech',
    facebook: 'Brunei\'s Digital Economy Blueprint is here — and TekyDoct is your partner for the journey. From cloud to CCTV to CRM, we have everything your business needs to go digital. Contact us today!'
  },
  'IP Surveillance & Smart Security': {
    linkedin: '🔐 Physical security is an integral part of your digital strategy. TekyDoct designs and deploys enterprise-grade IP surveillance systems with remote monitoring, analytics, and integration with your existing IT infrastructure. Protecting Brunei businesses since 2006. #IPCamera #SecuritySystems #SmartSecurity',
    instagram: '👁️ Always watching, always protecting. TekyDoct IP surveillance systems — HD cameras, remote access from your phone, 24/7 recording. DM for a free site assessment! #CCTV #IPCamera #SecurityBrunei',
    facebook: 'Your business deserves real security. TekyDoct installs IP CCTV systems with remote monitoring — see your premises from anywhere, anytime. Message us for a free consultation! 📷'
  },
  'Zoho One All-in-One Suite': {
    linkedin: '🔗 45+ integrated apps. One platform. One price. Zoho One replaces your fragmented tools with a unified business suite — CRM, accounting, HR, project management, and more. TekyDoct implements and customises Zoho One for Brunei businesses of every size. Ready to simplify? #ZohoOne #BusinessApps #SaaS',
    instagram: '✨ One app for everything your business needs 🙌 Zoho One = CRM + Finance + HR + Projects + 40 more apps. TekyDoct sets it up, trains your team, and supports you ongoing. #ZohoOne #ProductivityApps #SMETools',
    facebook: 'Stop paying for 10 different apps. Zoho One gives you 45+ business apps in one platform — and TekyDoct makes sure it\'s all set up perfectly for YOUR business. Ask us about a free Zoho One trial!'
  },
  'SME Cybersecurity Awareness': {
    linkedin: '⚠️ 60% of SMEs that suffer a cyber attack close within 6 months. Cybersecurity isn\'t just for enterprises — it\'s critical for every Brunei business. TekyDoct offers end-to-end security assessments, network hardening, and monitoring solutions scaled for SMEs. #Cybersecurity #SME #ITSecurity #Brunei',
    instagram: '🛡️ Protect your business before it\'s too late. Cyber threats don\'t discriminate by size. TekyDoct\'s SME security solutions are affordable and effective. DM us! #Cybersecurity #DataProtection #BruneiTech',
    facebook: 'Cyber attacks on small businesses are up 300% this year. Is your business protected? TekyDoct offers affordable cybersecurity solutions designed for Brunei SMEs. Message us for a free security health check!'
  }
};

function getCaption(trend, platform) {
  if (plannerCaptions[trend] && plannerCaptions[trend][platform]) {
    return plannerCaptions[trend][platform];
  }
  return `💡 ${trend} is shaping the future of business in Brunei. TekyDoct helps you stay ahead with expert solutions tailored to your needs. Contact us today! #TekyDoct #Brunei #Technology #DigitalTransformation`;
}

function getHashtags(platform) {
  const base = { linkedin: ['#TekyDoct', '#Brunei', '#DigitalTransformation', '#ZohoPartner'], instagram: ['#TekyDoct', '#BruneiTech', '#Innovation', '#SME'], facebook: ['#TekyDoct', '#Brunei', '#Technology'] };
  return base[platform] || base.linkedin;
}

function getBestTime(platform, dayIndex) {
  const times = {
    linkedin: ['09:00', '10:30', '11:00', '09:30', '10:00', '11:30', '10:00'],
    instagram: ['11:00', '18:00', '11:30', '17:00', '12:00', '11:00', '17:30'],
    facebook: ['13:00', '14:00', '13:30', '14:00', '14:00', '13:00', '14:00']
  };
  return (times[platform] || times.linkedin)[dayIndex % 7];
}

function generateWeeklyPlan(weekOffset = 0) {
  const health = computeBrandHealth();
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const hotTrends = trendBank.filter(t => t.heat === 'hot').slice(0, 5);
  const risingTrends = trendBank.filter(t => t.heat === 'rising').slice(0, 3);
  const allTrends = [...hotTrends, ...risingTrends];

  // Prioritise weaker platforms
  const platformsByPriority = ['linkedin', 'instagram', 'facebook'].sort((a, b) => health.platforms[a].score - health.platforms[b].score);

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const daySchedule = [
    ['linkedin', 'instagram'],
    ['linkedin'],
    ['facebook', 'instagram'],
    ['linkedin'],
    ['facebook', 'instagram'],
    ['instagram'],
    []
  ];

  const plan = days.map((dayName, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const platforms = daySchedule[i];
    const trendForDay = allTrends[i % allTrends.length];
    const posts = platforms.map(platform => ({
      id: `wp_${Date.now()}_${i}_${platform}`,
      platform,
      time: getBestTime(platform, i),
      trend: trendForDay.topic,
      caption: getCaption(trendForDay.topic, platform),
      hashtags: getHashtags(platform),
      predictedReach: Math.round({ linkedin: 1100, instagram: 1900, facebook: 800 }[platform] + Math.random() * 400),
      predictedEngagement: (Math.random() * 2.5 + 2.5).toFixed(1),
      status: 'pending'
    }));
    return { day: dayName, date: date.toISOString().split('T')[0], posts };
  });

  return {
    weekOf: monday.toISOString().split('T')[0],
    generatedAt: new Date().toISOString(),
    brandHealthSnapshot: { overall: health.overall, linkedin: health.platforms.linkedin.score, instagram: health.platforms.instagram.score, facebook: health.platforms.facebook.score },
    totalPosts: plan.reduce((a, d) => a + d.posts.length, 0),
    plan
  };
}

// In-memory stored plans
state.weeklyPlan = null;
state.monthlyPlan = null;
state.credentials = { linkedin: { clientId: '', clientSecret: '', redirectUri: `http://localhost:3000/oauth/linkedin/callback` }, instagram: { appId: '', appSecret: '', redirectUri: `http://localhost:3000/oauth/instagram/callback` }, facebook: { appId: '', appSecret: '', redirectUri: `http://localhost:3000/oauth/facebook/callback` } };

app.get('/api/planner/weekly', (req, res) => {
  const offset = parseInt(req.query.offset || '0');
  const plan = generateWeeklyPlan(offset);
  res.json(plan);
});

app.post('/api/planner/weekly/push', (req, res) => {
  const { posts } = req.body;
  let added = 0;
  for (const p of (posts || [])) {
    if (!p.caption || !p.platform) continue;
    const dt = p.date && p.time ? new Date(p.date + 'T' + p.time + ':00') : new Date();
    state.posts.unshift({ id: 'p' + Date.now() + added, platform: p.platform, content: p.caption, scheduledAt: dt.toISOString(), publishedAt: null, status: 'scheduled', engagement: null, image: null, createdAt: new Date().toISOString() });
    added++;
  }
  state.notifications.unshift({ id: 'n' + Date.now(), type: 'success', message: `${added} posts from Smart Planner added to schedule`, time: new Date().toISOString(), read: false });
  res.json({ success: true, added });
});

// Monthly plan
function generateMonthlyPlan(year, month) {
  const themes = [
    { week: 1, theme: 'Zoho Product Spotlight', color: '#7c3aed', icon: '🔮', focus: 'Highlight Zoho CRM, Zoho One, Zoho Books features and client wins' },
    { week: 2, theme: 'Security & Infrastructure', color: '#0077b5', icon: '🔒', focus: 'CCTV, networking, structured cabling, access control solutions' },
    { week: 3, theme: 'Digital Transformation', color: '#ec4899', icon: '🚀', focus: 'Client success stories, before/after digital journeys, case studies' },
    { week: 4, theme: 'Community & Brand', color: '#10b981', icon: '🌟', focus: 'Team highlights, company milestones, Brunei tech community engagement' }
  ];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const calendar = {};
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(year, month, d);
    const dow = date.getDay();
    const weekNum = Math.ceil((d + ((firstDay.getDay() + 6) % 7)) / 7);
    const theme = themes[Math.min(weekNum - 1, 3)];
    const platforms = [1, 2, 4].includes(dow) ? ['linkedin'] : [3].includes(dow) ? ['instagram', 'facebook'] : [5].includes(dow) ? ['instagram'] : [];
    if (!platforms.length) { calendar[d] = { date: date.toISOString().split('T')[0], theme: theme.theme, themeColor: theme.color, posts: [] }; continue; }
    const trend = trendBank[d % trendBank.length];
    calendar[d] = {
      date: date.toISOString().split('T')[0],
      theme: theme.theme, themeColor: theme.color, themeIcon: theme.icon,
      posts: platforms.map(pl => ({ platform: pl, time: getBestTime(pl, dow), topic: trend.topic, predictedReach: Math.round({ linkedin: 1200, instagram: 1800, facebook: 850 }[pl] + Math.random() * 300) }))
    };
  }
  return { year, month, monthName: new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' }), themes, calendar, totalPostDays: Object.values(calendar).filter(d => d.posts && d.posts.length > 0).length };
}

app.get('/api/planner/monthly', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year || now.getFullYear());
  const month = parseInt(req.query.month ?? now.getMonth());
  res.json(generateMonthlyPlan(year, month));
});

// ─── Settings: Credentials ────────────────────────────────────────────────────
app.get('/api/settings/credentials', (req, res) => {
  const masked = {};
  for (const [p, c] of Object.entries(state.credentials)) {
    masked[p] = { ...c };
    if (c.clientId) masked[p].clientId = c.clientId.slice(0, 6) + '…';
    if (c.appId) masked[p].appId = c.appId.slice(0, 6) + '…';
    if (c.clientSecret) masked[p].clientSecret = '••••••••';
    if (c.appSecret) masked[p].appSecret = '••••••••';
    masked[p].configured = !!(c.clientId || c.appId);
  }
  res.json(masked);
});

app.post('/api/settings/credentials', (req, res) => {
  const { platform, clientId, appId, clientSecret, appSecret } = req.body;
  if (!platform || !state.credentials[platform]) return res.status(400).json({ error: 'Invalid platform' });
  if (clientId !== undefined) state.credentials[platform].clientId = clientId;
  if (appId !== undefined) state.credentials[platform].appId = appId;
  if (clientSecret !== undefined) state.credentials[platform].clientSecret = clientSecret;
  if (appSecret !== undefined) state.credentials[platform].appSecret = appSecret;
  state.notifications.unshift({ id: 'n' + Date.now(), type: 'success', message: `${platform} credentials updated`, time: new Date().toISOString(), read: false });
  res.json({ success: true });
});

// ─── Serve SPA for all other routes ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ TekyDoct Social Planner running at http://localhost:${PORT}\n`);
  console.log('   Open your browser and go to: http://localhost:3000');
  console.log('   Press Ctrl+C to stop the server\n');
});
