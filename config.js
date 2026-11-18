// ============================================================================
//  config.js — 小镇唯一配置入口
//  分类配置集中放在 town.config.json；本模块负责加载、容错、类型归一化。
//  所有子模块 import { CONFIG } from './config.js' 后同步使用。
//  顶层 await 保证配置在任何场景构建代码执行前就绪。
// ============================================================================

const REQUIRED_SECTIONS = [
  'meta', 'town', 'buildings', 'scenery', 'environment',
  'npcs', 'commerce', 'player', 'assets', 'characters',
];

const ANGLE_TOKENS = {
  PI: Math.PI, '-PI': -Math.PI, '2PI': Math.PI * 2,
  'PI/2': Math.PI / 2, '-PI/2': -Math.PI / 2,
  'PI/4': Math.PI / 4, '-PI/4': -Math.PI / 4,
  '3PI/4': Math.PI * 3 / 4, '-3PI/4': -Math.PI * 3 / 4,
};

/** 颜色：配置里写 "0xRRGGBB" 字符串，运行时转成 three.js 用的数字。 */
export function color(value) {
  if (typeof value === 'string' && /^(0x|#)[0-9a-f]{6}$/i.test(value)) return Number(value.replace('#', '0x'));
  return value;
}

/** 角度：配置里写 "PI/2" 这类 token 或弧度数字。 */
/**
 * 通用数值表达式：支持 token（PI / H）+ 简单四则运算。
 * 用于角度、以及依赖 TOWN.half 的相对坐标，避免配置里写死派生数值。
 */
export function expr(value, tokens = ANGLE_TOKENS) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  if (text in tokens) return tokens[text];
  const match = text.match(/^([+-]?[\w/]+)\s*([+-]\s*[\d.]+)?$/);
  if (match) {
    const key = match[1].toUpperCase();
    let base = tokens[key];
    if (base === undefined && key.startsWith('-') && tokens[key.slice(1)] !== undefined) {
      base = -tokens[key.slice(1)];   // 支持 "-H" 这类负 token
    }
    base ??= Number(match[1]);
    if (!Number.isFinite(base)) return 0;
    const extra = match[2] ? Number(match[2].replace(/\s+/g, '')) : 0;
    return base + extra;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/** 角度：配置里写 "PI/2" / "PI+0.2" 这类 token 或弧度数字。 */
export function angle(value) {
  return expr(value, ANGLE_TOKENS);
}

/** 安全取分类，缺失时返回空对象并告警，避免整页崩掉。 */
export function section(name) {
  const value = CONFIG[name];
  if (value && typeof value === 'object') return value;
  console.warn(`[config] 缺少分类 "${name}"，已使用空配置`);
  return {};
}

async function loadConfig() {
  let url = './town.config.json';
  const override = new URLSearchParams(location.search).get('config');
  if (override && /^[a-z0-9_\-/.]+\.json$/i.test(override)) url = override;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const missing = REQUIRED_SECTIONS.filter(name => !(name in raw));
    if (missing.length) console.warn(`[config] 配置缺少分类: ${missing.join(', ')}`);
    return Object.freeze(raw);
  } catch (error) {
    // 配置加载失败时给出明确指引，不要静默降级到散落各处的魔数。
    throw new Error(
      `无法加载小镇配置 ${url}: ${error.message}。` +
      '请通过本地静态服务器打开页面（node serve.mjs），不要直接用 file:// 打开。'
    );
  }
}

export const CONFIG = await loadConfig();
