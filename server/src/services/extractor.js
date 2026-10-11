// ===== URL 解析服务 =====
// fetch + cheerio 提取 og:meta / 标题 / 正文；按平台识别。
// 登录墙平台（小红书/推特等）抓取失败时降级提示用户手动粘贴。

import * as cheerio from 'cheerio';
import { detectPlatform } from '../constants.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 这些平台强登录墙，直接提示手动粘贴，避免无谓请求
const WALLED_PLATFORMS = new Set(['xhs', 'twitter']);

const PLATFORM_TIPS = {
  xhs: '小红书内容需要登录才能查看，请打开笔记后复制正文粘贴给 InfoStation。',
  twitter: '推文内容需要登录才能查看，请复制推文正文粘贴给 InfoStation。',
  wechat: '部分公众号文章有防爬限制，若解析失败请复制正文手动粘贴。',
};

function textOf($, selectors) {
  for (const sel of selectors) {
    const v = $(sel).attr('content') || $(sel).text();
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** 粗提正文：取最大文本块 */
function extractMainContent($) {
  $('script, style, nav, header, footer, aside, iframe, noscript').remove();
  const candidates = ['article', '[role="main"]', 'main', '.article-content', '#js_content', '.rich_media_content', 'body'];
  let best = '';
  for (const sel of candidates) {
    const t = $(sel).text().replace(/\s+/g, ' ').trim();
    if (t.length > best.length) best = t;
  }
  return best.slice(0, 8000);
}

/**
 * 抓取 URL 并提取结构化信息
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, tip?: string}>}
 */
export async function extractUrl(url) {
  const platform = detectPlatform(url);

  if (WALLED_PLATFORMS.has(platform)) {
    return {
      ok: false,
      error: `「${platform}」平台内容需要登录才能查看，无法自动抓取。`,
      tip: PLATFORM_TIPS[platform],
      platform,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `目标页面返回 HTTP ${res.status}。`,
        tip: PLATFORM_TIPS[platform] || '可以直接复制页面正文，粘贴为文本输入。',
        platform,
      };
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const title =
      textOf($, ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'title']) ||
      $('h1').first().text().trim();

    const description = textOf($, [
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]);

    const author = textOf($, ['meta[property="og:article:author"]', 'meta[name="author"]']);

    const content = extractMainContent($);

    if (!title && !description && content.length < 50) {
      return {
        ok: false,
        error: '页面内容为空（可能是 JS 渲染页面或需要登录）。',
        tip: '请打开链接复制正文后，以文本方式粘贴给 InfoStation。',
        platform,
      };
    }

    return {
      ok: true,
      platform,
      data: {
        raw_url: url,
        raw_title: title.slice(0, 200),
        raw_text: (description && content.length < 50 ? description : content).slice(0, 8000),
        raw_metadata: {
          author: author || undefined,
          description: description || undefined,
        },
      },
    };
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? '抓取超时（15s）。' : `抓取失败：${err.message}`,
      tip: PLATFORM_TIPS[platform] || '可以直接复制页面正文，粘贴为文本输入。',
      platform,
    };
  } finally {
    clearTimeout(timer);
  }
}
