import { createStore, Store } from "redux";
import { throttle } from "lodash";
import { languageNamed } from "quicktype-core";

import * as query from "./query";
import { RootState } from "./types";
import { setLanguage, setSourceState, setLanguageOptions } from "./actions";
import { rootState } from "./reducers/RootState";

const stateKey = "state";

const overrideLanguage = (() => {
    function referredBy(host: string) {
        return document.referrer.indexOf(host) !== -1;
    }

    if (referredBy("json2csharp")) {
        // document.referrer is actually "quicktype.io?r=json2csharp..." (the link)
        // rather than "json2csharp.com"
        return "C#";
    }

    // Override stored language with query string
    const queryLanguageName = query.get<string>("l", "lang", "language");
    if (queryLanguageName !== undefined) {
        const queryLanguage = languageNamed(queryLanguageName);
        if (queryLanguage !== undefined) {
            return queryLanguage.displayName;
        }
    }
    return undefined;
})();

const overrideSample = query.get<string>("s", "sample");

function loadState(): RootState | undefined {
    try {
        const serializedState = localStorage.getItem(stateKey);
        if (serializedState === null) {
            return undefined;
        }
        return JSON.parse(serializedState);
    } catch (err) {
        console.error("Cannot load state", err);
        return undefined;
    }
}

function saveState(state: RootState | undefined) {
    try {
        const serializedState = JSON.stringify(state);
        localStorage.setItem(stateKey, serializedState);
    } catch (err) {
        console.error("Cannot save state", err);
    }
}

function loadLanguageOptionsFromQuery(store: Store<RootState>) {
    const language = languageNamed(store.getState().optionsPad.language);
    if (language !== undefined) {
        for (const option of language.optionDefinitions) {
            const overrideOption = query.get<string>(option.name);

            if (overrideOption === undefined) {
                continue;
            }

            let value: any;
            if (option.type === Boolean) {
                value = ["true", "yes", "1"].indexOf(overrideOption) !== -1;
            } else if (option.type === String) {
                if (option.legalValues !== undefined && option.legalValues.indexOf(overrideOption) === -1) {
                    continue;
                }
                value = overrideOption;
            } else {
                continue;
            }

            store.dispatch(setLanguageOptions(language.displayName, { rendererOptions: { [option.name]: value } }));
        }
    }
}

export function configureStore(initialState: Partial<RootState> = {}) {
    const state = { ...loadState(), ...initialState };
    const store = createStore(rootState, state as RootState);

    if (overrideLanguage !== undefined) {
        store.dispatch(setLanguage(overrideLanguage));
    }

    if (overrideSample !== undefined) {
        store.dispatch(setSourceState({ sample: overrideSample }));
    }

    loadLanguageOptionsFromQuery(store);

    store.subscribe(
        throttle(() => {
            saveState(store.getState());
        }, 1000)
    );
    return store;
}
