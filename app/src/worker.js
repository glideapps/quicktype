import Main from "../../output/Main";
import * as _ from "lodash";

function getRenderer(name) {
    return _.find(Main.renderers, { name }) || Main.renderers[0];
}

function render({ json, language, topLevelName, receipt }) {
    const renderEventName = `Parse and render ${language}`;
    console.time(renderEventName);
    let result = Main.main({
        outFile: "web",
        language,
        topLevels: [
            {
                name: topLevelName,
                sample: json
            }
        ]
    });
    console.timeEnd(renderEventName);
    return { receipt, result };
}

 // eslint-disable-next-line no-restricted-globals
self.addEventListener("message", message => {
    postMessage(render(message.data));
});
