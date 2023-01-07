import { AnyAction } from "redux";
import { merge } from "lodash";

import { languageNamed, defaultInferenceFlags, InferenceFlags } from "quicktype-core";

import { ActionType, setLanguage } from "../actions";
import { defined } from "../util";
import { OptionsPadState, LanguageOptions } from "../types";

const customWebOptions: Record<string, any> = {
    "Objective-C": {
        "extra-comments": true
    },
    Swift: {
        initializers: false
    },
    Rust: {
        density: "dense"
    }
};

function defaultLanguageOptions(languageName: string): LanguageOptions {
    const language = defined(languageNamed(languageName));
    let options: Record<string, any> = {};
    for (const def of language.optionDefinitions) {
        options[def.name] = def.defaultValue;
    }
    return {
        ...defaultInferenceFlags,
        allPropertiesOptional: false,
        rendererOptions: merge(options, customWebOptions[languageName] || {})
    };
}

const defaultLanguage = "Swift";

const defaultState: OptionsPadState = {
    language: defaultLanguage,
    options: { [defaultLanguage]: defaultLanguageOptions(defaultLanguage) }
};

export default function optionsPad(state: OptionsPadState = defaultState, action: AnyAction): OptionsPadState {
    switch (action.type) {
        case ActionType.SetLanguage:
            const language: string = action.payload;
            return {
                ...state,
                language,
                options: {
                    ...state.options,
                    [language]: state.options[language] || defaultLanguageOptions(language)
                }
            };

        case ActionType.SetLanguageOption:
            const newOptions: LanguageOptions = action.payload;
            const languageOptions = state.options[state.language];
            return {
                ...state,
                options: {
                    ...state.options,
                    [state.language]: {
                        ...languageOptions,
                        ...newOptions,
                        rendererOptions: {
                            ...languageOptions.rendererOptions,
                            ...newOptions.rendererOptions
                        }
                    }
                }
            };

        case ActionType.SetInferenceFlags:
            const inferenceOptions: InferenceFlags = action.payload;
            return {
                ...state,
                options: {
                    ...state.options,
                    [state.language]: {
                        ...state.options[state.language],
                        ...inferenceOptions
                    }
                }
            };

        default:
            // TODO how to we handle initialization specifically?
            // We modified OptionsPadState to include `options`
            if (state.options[state.language] === undefined) {
                return optionsPad(state, setLanguage(state.language));
            }
            return state;
    }
}
