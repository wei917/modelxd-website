// lib/markdown.ts — the remark plugin set every markdown-body renderer uses.
//
// CommonMark's emphasis rule needs whitespace or punctuation on the outside
// of `**`, so a bold that ends at a CJK full stop and is followed by more CJK
// text (平衡。**下一句) renders as literal asterisks — which is exactly what
// the owner saw in an XTell reading (Sep 24). remark-cjk-friendly (MIT)
// relaxes the rule for CJK the way GitHub does. One shared array so a new
// renderer cannot forget it.

import remarkCjkFriendly from 'remark-cjk-friendly'

export const REMARK_PLUGINS = [remarkCjkFriendly]
