export type CommentOptions = {
    lineStart?: string;
    lineEnd?: string;
    beforeComment?: string;
    afterComment?: string;
    firstLineStart?: string;
};

type DescriptionBlockCommentConfig = { descriptionBlock: string[] };
type InlineCommentConfig = { lines: string[] };
type CustomCommentConfig = CommentOptions & {
    customLines: string[];
};

export type CommentConfig = DescriptionBlockCommentConfig | InlineCommentConfig | CustomCommentConfig;

export type Comment = string | CommentConfig;

export const isStringComment = (comment: Comment): comment is string => {
    return typeof comment === "string";
};
