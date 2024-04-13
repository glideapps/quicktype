import { Sourcelike } from "../Source";

export type CommentOptions = {
    lineStart?: string;
    lineEnd?: string;
    beforeComment?: string;
    afterComment?: string;
    firstLineStart?: string;
};

type DescriptionBlockCommentConfig = { descriptionBlock: Sourcelike[] };
type InlineCommentConfig = { lines: Sourcelike[] };
type CustomCommentConfig = CommentOptions & {
    customLines: Sourcelike[];
};

export type CommentConfig = DescriptionBlockCommentConfig | InlineCommentConfig | CustomCommentConfig;

export type Comment = string | CommentConfig;

export const isStringComment = (comment: Comment): comment is string => {
    return typeof comment === "string";
};
