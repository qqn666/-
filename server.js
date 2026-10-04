const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ============ JSON 文件存储 ============
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, '[]');
  if (!fs.existsSync(LIKES_FILE)) fs.writeFileSync(LIKES_FILE, '[]');
  if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, '{}');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (e) { return file === TOKENS_FILE ? {} : []; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// 头像颜色池
const AVATAR_COLORS = [
  { bg: '#FF6F32', key: 1 }, { bg: '#4A90D9', key: 2 },
  { bg: '#52C41A', key: 3 }, { bg: '#F5A623', key: 4 },
  { bg: '#BD10E0', key: 5 }
];
// 图片占位颜色
const IMG_COLORS = [
  '#FFD3B6', '#A0E7E5', '#B4F8C8', '#FBE7C6', '#B9D7EA',
  '#E2C2C6', '#C7CEEA', '#FF9AA2', '#FFB7B2'
];

// ============ 工具函数 ============
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

function now() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 鉴权中间件
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ code: 401, msg: '未登录' });
  const tokens = readJson(TOKENS_FILE);
  const userId = tokens[token];
  if (!userId) return res.status(401).json({ code: 401, msg: '登录已过期' });
  const users = readJson(USERS_FILE);
  req.user = users.find(u => u.id === userId);
  if (!req.user) return res.status(401).json({ code: 401, msg: '用户不存在' });
  next();
}

// ============ 用户接口 ============
// 注册
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ code: 400, msg: '用户名和密码不能为空' });
  const users = readJson(USERS_FILE);
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ code: 400, msg: '用户名已存在' });
  }
  const color = AVATAR_COLORS[users.length % AVATAR_COLORS.length];
  const user = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    username,
    password: md5(password),
    avatarColor: color.bg,
    avatarColorKey: color.key,
    avatarText: username.charAt(0).toUpperCase(),
    createdAt: now()
  };
  users.push(user);
  writeJson(USERS_FILE, users);

  const token = genToken();
  const tokens = readJson(TOKENS_FILE);
  tokens[token] = user.id;
  writeJson(TOKENS_FILE, tokens);

  res.json({ code: 200, msg: '注册成功', data: { token, user: safeUser(user) } });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ code: 400, msg: '用户名和密码不能为空' });
  const users = readJson(USERS_FILE);
  const user = users.find(u => u.username === username && u.password === md5(password));
  if (!user) return res.status(400).json({ code: 400, msg: '用户名或密码错误' });

  const token = genToken();
  const tokens = readJson(TOKENS_FILE);
  tokens[token] = user.id;
  writeJson(TOKENS_FILE, tokens);

  res.json({ code: 200, msg: '登录成功', data: { token, user: safeUser(user) } });
});

function safeUser(user) {
  return { id: user.id, username: user.username, avatarColor: user.avatarColor, avatarColorKey: user.avatarColorKey, avatarText: user.avatarText };
}

// ============ 帖子接口 ============
// 帖子列表
app.get('/api/posts', (req, res) => {
  const posts = readJson(POSTS_FILE);
  const users = readJson(USERS_FILE);
  const likes = readJson(LIKES_FILE);
  const token = req.headers.authorization;
  const tokens = readJson(TOKENS_FILE);
  const currentUserId = token ? tokens[token] : null;

  const list = posts.map(p => {
    const author = users.find(u => u.id === p.userId);
    const likeCount = likes.filter(l => l.postId === p.id).length;
    const liked = currentUserId ? likes.some(l => l.postId === p.id && l.userId === currentUserId) : false;
    return {
      id: p.id,
      userId: p.userId,
      userName: author ? author.username : '未知用户',
      avatarColor: author ? author.avatarColor : '#FF6F32',
      avatarColorKey: author ? author.avatarColorKey : 1,
      avatarText: author ? author.avatarText : '?',
      content: p.content,
      images: p.images || [],
      repostName: p.repostName || null,
      repostContent: p.repostContent || null,
      repostCount: p.repostCount || 0,
      commentCount: p.commentCount || 0,
      likeCount,
      liked,
      createdAt: p.createdAt
    };
  }).sort((a, b) => b.id - a.id);

  res.json({ code: 200, data: list });
});

// 发帖
app.post('/api/posts', auth, (req, res) => {
  const { content, images, repostName, repostContent } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ code: 400, msg: '内容不能为空' });

  const posts = readJson(POSTS_FILE);
  const post = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    userId: req.user.id,
    content: content.trim(),
    images: images && images.length ? images.slice(0, 9) : [],
    repostName: repostName || null,
    repostContent: repostContent || null,
    repostCount: 0,
    commentCount: 0,
    createdAt: now()
  };
  posts.push(post);
  writeJson(POSTS_FILE, posts);

  res.json({ code: 200, msg: '发布成功', data: { id: post.id } });
});

// 点赞/取消点赞
app.post('/api/posts/:id/like', auth, (req, res) => {
  const postId = Number(req.params.id);
  const likes = readJson(LIKES_FILE);
  const idx = likes.findIndex(l => l.postId === postId && l.userId === req.user.id);
  let liked;
  if (idx >= 0) {
    likes.splice(idx, 1);
    liked = false;
  } else {
    likes.push({ postId, userId: req.user.id, createdAt: now() });
    liked = true;
  }
  writeJson(LIKES_FILE, likes);
  const likeCount = likes.filter(l => l.postId === postId).length;
  res.json({ code: 200, data: { liked, likeCount } });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 200, msg: 'ok', time: now() });
});

ensureFiles();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`论坛后端已启动: http://0.0.0.0:${PORT}`);
});
