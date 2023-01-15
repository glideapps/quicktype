import { Options, InferenceFlags } from "quicktype-core";

import { Source, SourceType } from "./quicktype";

export interface RootState {
    userState: UserState;
    optionsPad: OptionsPadState;
    sourcePad: SourcePadState;
    layout: LayoutState;
}

export type LayoutState = {
    displayOptions: boolean;
};

export type WorkerRenderMessage = {
    receipt: number;
    options: Partial<Options>;
    sourceType: SourceType;
    sources: Source[];
};

export type OptionsPadState = {
    language: string;
    options: { [language: string]: LanguageOptions };
};

export type LanguageOptions = InferenceFlags & {
    allPropertiesOptional: boolean;
    rendererOptions: { [key: string]: any };
};

export interface SourcePadState {
    sample: string;
    sources: Source[];
    sourceType: SourceType;
    selectedNode: number;
    expandedNodes: number[];
    leadingComments?: string[];
}

export type UserState = BaseUserState;

export type BaseUserState = {
    visits: number;
    copies: number;
};
