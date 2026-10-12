// ===== API Token 认证中间件 =====
// .env 配置 API_TOKEN 后，所有 /api/v1/* 强制鉴权（Authorization: Bearer <token> 或 X-API-Key: <token>）。
// 未配置 API_TOKEN 时开放访问（本地开发模式）。

export function requireToken(req, res, next) {
  const token = process.env.API_TOKEN;
  if (!token) return next(); // 本地开发：未配置即开放

  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const apiKey = req.headers['x-api-key'] || '';
  const provided = bearer || apiKey;

  if (provided && timingSafeEqual(provided, token)) return next();

  return res.status(401).json({
    error: '未授权：需要 API Token（Authorization: Bearer <token> 或 X-API-Key: <token>）',
  });
}

/** 常数时间字符串比较，避免时序侧信道 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
