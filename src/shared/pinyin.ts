// 基于 Intl.Collator 汉语拼音排序规则的轻量首字母与子序列检索工具。
const collator = new Intl.Collator('zh-CN-u-co-pinyin')

// 23 个汉语拼音声母区间锚点（不含 i / u / v）。
const initialAnchors: ReadonlyArray<readonly [string, string]> = [
  ['a', '\u5416'],
  ['b', '\u82ad'],
  ['c', '\u64e6'],
  ['d', '\u642d'],
  ['e', '\u86fe'],
  ['f', '\u53d1'],
  ['g', '\u5676'],
  ['h', '\u54c8'],
  ['j', '\u51fb'],
  ['k', '\u5580'],
  ['l', '\u5783'],
  ['m', '\u5988'],
  ['n', '\u62ff'],
  ['o', '\u54e6'],
  ['p', '\u556a'],
  ['q', '\u671f'],
  ['r', '\u7136'],
  ['s', '\u6492'],
  ['t', '\u584c'],
  ['w', '\u6316'],
  ['x', '\u6614'],
  ['y', '\u538b'],
  ['z', '\u531d']
]

const charInitialCache = new Map<string, string>()

function hanInitial(ch: string): string {
  const cached = charInitialCache.get(ch)
  if (cached !== undefined) return cached
  const code = ch.charCodeAt(0)
  if (code < 0x4e00 || code > 0x9fff) {
    const lower = ch.toLocaleLowerCase()
    charInitialCache.set(ch, lower)
    return lower
  }
  if (collator.compare(ch, initialAnchors[0][1]) < 0) {
    charInitialCache.set(ch, ch)
    return ch
  }
  let low = 0
  let high = initialAnchors.length - 1
  let picked = initialAnchors[0][0]
  while (low <= high) {
    const mid = (low + high) >> 1
    if (collator.compare(ch, initialAnchors[mid][1]) >= 0) {
      picked = initialAnchors[mid][0]
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (charInitialCache.size > 4096) charInitialCache.clear()
  charInitialCache.set(ch, picked)
  return picked
}

export function extractPinyinInitials(text: string): string {
  let out = ''
  for (const ch of text) {
    if (/\s/.test(ch)) continue
    out += hanInitial(ch)
  }
  return out
}

function isSubsequence(haystack: string, needle: string): boolean {
  let j = 0
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++
  }
  return j === needle.length
}

export function matchesSearchQuery(text: string, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return true
  const normalized = text.toLocaleLowerCase()
  if (normalized.includes(query)) return true
  if (!/^[a-z0-9]+$/.test(query)) return false
  const initials = extractPinyinInitials(text)
  return initials.includes(query) || isSubsequence(initials, query)
}
