const { startsWithSeq, peekerate } = require('iter-tools-es');
const { exec, parse, Pattern } = require('@iter-tools/regex');
const regexEscape = require('escape-string-regexp');

const { isArray } = Array;

const breakPattern = /[(){}\s\/\\&#@!`+^%?<>,.;:'"|~-]|$/.source;

const match_ = (descriptors, source) => {
  const matchSource = source.fork();
  const matches = [];
  for (const descriptor of descriptors) {
    if (matchSource.done) return null;
    const match = matchSource.match(descriptor);
    if (!match) return null;
    matches.push(...match);
    matchSource.advance(match);
  }
  return matches;
};

const Optional = (descriptor) => {
  return {
    type: descriptor.type,
    value: descriptor.value,
    build() {
      return [];
    },
    matchTokens(cstTokens) {
      const match = descriptor.matchTokens(cstTokens);
      return match === null ? [] : match;
    },
    matchChrs(chrs) {
      const match = descriptor.matchChrs(chrs);
      return match === null ? [] : match;
    },
  };
};

const nullPattern = parse(`(null)${breakPattern}`, 'y');
const nullToken = { type: 'Null', value: 'null' };
const _Null = {
  type: 'Null',
  value: null,
  build() {
    return [nullToken];
  },
  matchTokens(cstTokens) {
    const token = cstTokens.value;
    const { type, value: tValue } = token;
    return type === 'Null' && tValue === 'null' ? this.build() : null;
  },
  matchChrs(chrs) {
    return exec(nullPattern, chrs)[1] ? this.build() : null;
  },
};

const Null = () => _Null;

const Boolean = (value) => {
  const strValue = value ? 'true' : 'false';
  return {
    type: 'Boolean',
    value,
    build(value) {
      return [{ type: 'Boolean', value: strValue }];
    },
    matchTokens(cstTokens) {
      const token = cstTokens.value;
      const { type, value: tValue } = token;
      return type === 'Boolean' && tValue === strValue ? this.build() : null;
    },
  };
};

const Text = (matchValue) => (value) => {
  const defaultValue = value;
  return {
    type: 'Text',
    value,
    build(value) {
      return [{ type: 'Text', value: value || defaultValue }];
    },
    matchTokens(cstTokens) {
      const match = [];
      const matchSource = cstTokens.fork();
      while (!matchSource.done && matchSource.value.type === 'Text') {
        match.push(matchSource.value);
        matchSource.advance([cstTokens.value]);
      }
      return match.length ? match : null;
    },
    matchChrs(chrs) {
      return matchValue(chrs, value) ? this.build() : null;
    },
  };
};

const parseNumeric = (str) => {
  if (str.includes('.') || str.includes('e')) {
    return parseFloat(str);
  } else if (str.startsWith('0x')) {
    return parseInt(str, 16);
  } else if (str.startsWith('0')) {
    return parseInt(str, 8);
  } else {
    return parseInt(str, 10);
  }
};
const numberIsSame = (a, b) => {
  return a === b || parseNumeric(a) === parseNumeric(b);
};

const binPattern = /0b[01](_?[01])*/.source;
const octPattern = /0o[0-7](_?[0-7])*/.source;
const hexPattern = /0x[0-9a-f](_?[0-9a-f])*/.source;
const decPattern = /\d(_?\d)*(\.\d(_?\d)*)?(e(\+-)?\d(_?\d)*)?/.source;
const numPattern = new Pattern(
  `(${binPattern}|${octPattern}|${hexPattern}|${decPattern})${breakPattern}`,
  'iy',
);

const Numeric = (value) => {
  const expectedValue = value;
  return {
    type: 'Numeric',
    value,
    build(value) {
      return [{ type: 'Numeric', value: value === undefined ? value : defaultValue }];
    },
    matchTokens(cstTokens) {
      const token = cstTokens.value;
      const { type, value: tValue } = token;
      return type === 'Numeric' && numberIsSame(tValue, value) ? [token] : null;
    },
    matchChrs(chrs) {
      let match = exec(numPattern, chrs)[1];

      if (!match) {
        return null;
      }

      match = match.replace(/_/g, '');

      let value;
      if (match.startsWith('0b')) {
        value = parseInt(match.slice(2), 2);
      } else if (match.startsWith('0o')) {
        value = parseInt(match.slice(2), 8);
      } else if (match.startsWith('0x')) {
        value = parseInt(match.slice(2), 16);
      } else if (match.startsWith('0') && /[0-8]+/.test(match)) {
        // legacy octal
        // values like 09 fall back to decimal
        value = parseInt(match.slice(1), 8);
      } else {
        value = parseFloat(match);
      }

      return expectedValue === value ? [this.build(value)] : null;
    },
  };
};

const CommentStart = (value) => {
  return {
    type: 'CommentStart',
    value,
    build() {
      return [{ type: 'CommentStart', value }];
    },
    matchTokens(cstTokens) {
      const token = cstTokens.value;
      const { type, value: tValue } = token;
      return type === 'CommentStart' && tValue === value ? [token] : null;
    },
    matchChrs(chrs) {
      return startsWithSeq(value, chrs) ? this.build() : null;
    },
  };
};

const CommentEnd = (value) => {
  return {
    type: 'CommentEnd',
    value,
    build() {
      return [{ type: 'CommentEnd', value }];
    },
    matchTokens(cstTokens) {
      const token = cstTokens.value;
      const { type, value: tValue } = token;
      return type === 'CommentEnd' && tValue === value ? [token] : null;
    },
    matchChrs(chrs) {
      return startsWithSeq(value, chrs) ? this.build() : null;
    },
  };
};

const blockCommentTextPattern = parse(/(.+)\*\//sy);
const BlockCommentText = Text((chrs, value) => {
  return exec(blockCommentTextPattern, chrs)[1] || null;
});

const lineCommentTextPattern = parse(/[^\n]+/y);
const LineCommentText = Text((chrs, value) => {
  return exec(lineCommentTextPattern, chrs)[0] || null;
});

const Comment = (value) => {
  const lcText = LineCommentText(value);
  const bcText = BlockCommentText(value);
  return {
    type: 'Comment',
    value,
    build(value) {
      if (value.startsWith('//')) {
        return [...lcStart.build(), ...lcText.build(value.slice(2))];
      } else if (value.startsWith('/*') && value.endsWith('*/')) {
        return [...bcStart.build(), ...bcText.build(value.slice(2, -2)), ...bcEnd.build()];
      } else {
        throw new Error('Comment value was not a valid comment');
      }
    },
    matchTokens(cstTokens) {
      return (
        match_([lcStart, lcText], cstTokens) ||
        match_([lcStart], cstTokens) ||
        match_([bcStart, bcText, bcEnd], cstTokens) ||
        match_([bcStart, bcEnd], cstTokens)
      );
    },
    matchChrs(chrs) {
      return this.matchTokens(chrs);
    },
  };
};

const whitespacePattern = parse(/\s+/y);

const Whitespace = (value = ' ') => {
  const defaultValue = value;
  return {
    type: 'Whitespace',
    value,
    build(value) {
      return [{ type: 'Whitespace', value: value || defaultValue }];
    },
    matchTokens(cstTokens) {
      const match = [];
      // What should I do with '' whitespace values?
      const matchSource = cstTokens.fork();
      while (!matchSource.done && matchSource.value.type === 'Whitespace') {
        match.push(matchSource.value);
        matchSource.advance([matchSource.value]);
      }
      return match.length ? match : null;
    },
    matchChrs(chrs) {
      const value = exec(whitespacePattern, chrs)[0];
      return value ? this.build(value) : null;
    },
  };
};

const Punctuator = (value) => ({
  type: 'Punctuator',
  value,
  build() {
    return [{ type: 'Punctuator', value }];
  },
  matchTokens(cstTokens) {
    const token = cstTokens.value;
    const { type, value: tValue } = token;
    return type === 'Punctuator' && tValue === value ? [token] : null;
  },
  matchChrs(chrs) {
    return startsWithSeq(value, chrs) ? this.build() : null;
  },
});

const Keyword = (value) => {
  const pattern = parse(`(${regexEscape(value)})${breakPattern}`, 'y');
  return {
    type: 'Keyword',
    value,
    build() {
      return [{ type: 'Keyword', value }];
    },
    matchTokens(cstTokens) {
      const token = cstTokens.value;
      const { type, value: tValue } = token;
      return type === 'Keyword' && tValue === value ? [token] : null;
    },
    matchChrs(chrs) {
      return exec(pattern, chrs)[1] ? this.build() : null;
    },
  };
};

const Identifier = (value) => {
  const defaultValue = value;
  const pattern = parse(`(${regexEscape(value)})${breakPattern}`, 'y');
  return {
    type: 'Identifier',
    value,
    build(value) {
      return [{ type: 'Identifier', value: value || defaultValue }];
    },
    matchTokens(cstTokens) {
      const token = cstTokens.value;
      const { type, value: tValue } = token;
      return type === 'Identifier' && tValue === value ? [token] : null;
    },
    matchChrs(chrs) {
      return exec(pattern, chrs)[1] ? this.build() : null;
    },
  };
};

const RegularExpression = (value) => {
  const pattern = parse(`(${regexEscape(value)})${breakPattern}`, 'y');
  return {
    type: 'RegularExpression',
    value,
    build() {
      return { type: 'RegularExpression', value };
    },
    matchTokens(cstTokens) {
      const token = cstTokens.value;
      const { type, value: tValue } = token;
      return type === 'RegularExpression' && tValue === value ? [token] : null;
    },
    matchChrs(chrs) {
      return exec(pattern, chrs)[1] ? this.build() : null;
    },
  };
};

const Reference = (value) => ({
  type: 'Reference',
  value,
  build() {
    return [{ type: 'Reference', value }];
  },
  matchTokens(cstTokens) {
    const token = cstTokens.value;
    const { type, value: tValue } = token;
    return type === 'Reference' && tValue === value ? [token] : null;
  },
  matchChrs(chrs) {
    // The coroutine must evaluate the referenced node to determine if it matches
    throw new Error('not implemented');
  },
});

const Separator = () => ({
  type: 'Separator',
  value: undefined,
  build() {
    return ws.build();
  },
  matchTokens(cstTokens) {
    const matchSource = cstTokens.fork();
    const matches = [];
    let match;
    while ((match = matchSource.match(ws) || matchSource.match(cmt))) {
      matchSource.advance(match);
      matches.push(...match);
    }
    return matches;
  },
  matchChrs(chrs) {
    return this.matchTokens(chrs);
  },
});

const buildMatchStringChrs = (terminator) => {
  return (chrs, value) => {
    const peekr = peekerate(chrs.fork());

    const match = [];
    for (const chr of value) {
      if (peekr.done) break;
      // TODO escapes
      //   necessary escapes, e.g. \'
      //   unnecessary escapes, e.g. \d
      //   unicode escapes, e.g. \u0064
      if (peekr.value === chr) {
        match.push(chr);
        peekr.advance();
      } else {
        return null;
      }
    }
    return match;
  };
};

const SingleQuoteStringBody = Text(buildMatchStringChrs("'"));
const DoubleQuoteStringBody = Text(buildMatchStringChrs('"'));

const String = (value) => {
  const sQuotText = SingleQuoteStringBody(value);
  const dQuotText = DoubleQuoteStringBody(value);
  const astValue = value;
  return {
    type: 'String',
    value,
    build(value) {
      if (!value || (value.startsWith("'") && value.endsWith("'"))) {
        return [...sQuot.build(), ...sQuotText.build(astValue), ...sQuot.build()];
      } else if (value.startsWith('"') && value.endsWith('"')) {
        return [...dQuot.build(), ...dQuotText.build(astValue), ...dQuot.build()];
      } else {
        throw new Error('String value was not a valid string');
      }
    },
    matchTokens(cstTokens) {
      // prettier-ignore
      return match_([sQuot, sQuotText, sQuot], cstTokens) || match_([dQuot, dQuotText, dQuot], cstTokens);
    },
    matchChrs(chrs) {
      return match_([sQuot, sQuotText, sQuot], chrs) || match_([dQuot, dQuotText, dQuot], chrs);
    },
  };
};

const ws = Whitespace();
const lcStart = CommentStart('//');
const bcStart = CommentStart('/*');
const bcEnd = CommentEnd('*/');
const sQuot = Punctuator("'");
const dQuot = Punctuator('"');
const cmt = Comment();
const sep = Separator();

const stripArray = (value) => (isArray(value) ? value[0] : value);

// Shorthand names for more concise grammar definitions
// stripArray ensures that both ID`value` and ID(value) are valid
const OPT = Optional;
const NULL = Null;
const BOOL = (value) => Boolean(stripArray(value));
const NUM = (value) => Numeric(stripArray(value));
const WS = (value = '') => Whitespace(stripArray(value));
const PN = (value) => Punctuator(stripArray(value));
const KW = (value) => Keyword(stripArray(value));
const ID = (value) => Identifier(stripArray(value));
const STR = (value) => String(stripArray(value));
const RE = (value) => RegularExpression(stripArray(value));
const ref = (value) => Reference(stripArray(value));
const _ = Optional(sep);
const __ = sep;

module.exports = { OPT, NULL, BOOL, NUM, WS, PN, KW, ID, STR, RE, ref, _, __ };
