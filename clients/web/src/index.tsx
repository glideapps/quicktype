import * as lodash from "lodash";
import * as ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { BrowserRouter as Router } from "react-router-dom";
import { Store } from "redux";
import App from "./components/App";
import { configureStore } from "./store";
import "./styles/index.css";
import { RootState } from "./types";

function render(store: Store<RootState>) {
    ReactDOM.render(
        <Router>
            <Provider store={store}>
                <App store={store} />
            </Provider>
        </Router>,
        document.getElementById("root") as HTMLElement
    );
}

async function main() {
    lodash.templateSettings.interpolate = /{{([\s\S]+?)}}/g;

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
