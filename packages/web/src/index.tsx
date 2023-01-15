import React from "react";
import _ from "lodash";
import * as ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { Store } from "redux";
import App from "./components/App";
import { configureStore } from "./store";
import "./styles/index.css";
import { RootState } from "./types";

console.log("Hello from the web package!");

function render(store: Store<RootState>) {
    const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
    root.render(
        <React.StrictMode>
            <Provider store={store}>
                <App store={store} />
            </Provider>
        </React.StrictMode>
    );
}

async function main() {
    _.templateSettings.interpolate = /{{([\s\S]+?)}}/g;

    (window as any).embedded = (() => {
        try {
            return window.self !== window.top;
        } catch (e) {
            return true;
        }
    })();

    const store = configureStore({});

    render(store);
}

main();
