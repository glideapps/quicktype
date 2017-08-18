import Main from "../../output/Main";
import * as _ from "lodash";

function getRenderer(name) {
    return _.find(Main.renderers, { name }) || Main.renderers[0];
}

function render({ input, rendererName, topLevelName }) {
    return Main.renderFromJsonStringPossiblyAsSchemaInDevelopment(topLevelName)({
        input,
        renderer: getRenderer(rendererName)
    });
}

 // eslint-disable-next-line no-restricted-globals
self.addEventListener("message", message => {
    postMessage(render(message.data));
});