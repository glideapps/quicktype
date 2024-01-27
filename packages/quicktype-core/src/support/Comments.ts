type DescriptionBlockCommentConfig = { descriptionBlock: string[] };
type InlineCommentConfig = { lines: string[] };
type CustomCommentConfig = {
    lineStart?: string;
    beforeLine?: string;
    afterLine?: string;
    firstLineStart?: string;
};

type CommentConfig = DescriptionBlockCommentConfig | InlineCommentConfig | CustomCommentConfig;

export type LeadingComments = string[] | CommentConfig;
