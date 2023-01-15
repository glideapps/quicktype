import * as _ from "lodash";
import queryString from "query-string";

import * as analytics from "./analytics";

import "./styles/tweet.css";

const hashtag: Record<string, string> = {
    "C#": "csharp",
    "Objective-C": "objectivec",
    "JSON Schema": "jsonschema",
    Go: "golang",
    "C++": "cplusplus"
};

const boringWords = [
    "boring",
    "vile",
    "uninspiring",
    "colorless",
    "lifeless",
    "insipid",
    "bland",
    "lackluster",
    "soul-destroying",
    "rote",
    "tedious",
    "mindless",
    "mind-numbing",
    "odious",
    "simple-minded",
    "lame",
    "annoying"
];

const workWords = [
    "bullshit",
    "drudgery",
    "labor",
    "donkey work",
    "toil",
    "tedium",
    "ennui",
    "dullness",
    "inanity",
    "mindlessness",
    "monotony",
    "keyboard-mashing"
];

function handleTweetIntentClick(e: any, url: string) {
    const windowOptions = "scrollbars=yes,resizable=yes,toolbar=no,location=yes",
        width = 550,
        height = 420,
        winHeight = window.screen.height,
        winWidth = window.screen.width;

    e = e || window.event;

    const left = Math.round(winWidth / 2 - width / 2);
    let top = 0;

    if (winHeight > height) {
        top = Math.round(winHeight / 2 - height / 2);
    }

    window.open(
        url,
        "intent",
        windowOptions + ",width=" + width + ",height=" + height + ",left=" + left + ",top=" + top
    );
    // tslint:disable-next-line:no-unused-expression
    e.preventDefault && e.preventDefault();
}

function workEstimateForSource(source: string) {
    const linesPerMinute = 8.5;
    const lines = source.split("\n").length;

    let minutes = Math.round(lines / linesPerMinute);
    let hours = Math.floor(minutes / 60);

    let timeLabel: string;
    switch (hours) {
        case 0:
            timeLabel = `${minutes} minutes`;
            break;
        case 1:
            timeLabel = `1 hour ${minutes % 60} minutes`;
            break;
        default:
            timeLabel = `${hours} hours ${minutes % 60} minutes`;
    }
    return { lines, timeLabel, minutes };
}

function boringWork() {
    const boring = boringWords[_.random(boringWords.length - 1)];
    const work = workWords[_.random(workWords.length - 1)];
    return [boring, work].join(" ");
}

export function composeTweet(source: string, language: string, link: string): void {
    const tag = hashtag[language] ? `#${hashtag[language]}` : `#${language.toLowerCase()}`;
    const { lines, timeLabel } = workEstimateForSource(source);

    const tweetTemplate = [
        `I just skipped {{ time }} of ${boringWork()}`,
        `by generating {{ lines }} lines of {{ hashtag }}`,
        `with @quicktypeio 🎉😎 {{ link }}`
    ].join(" ");

    const tweet = _.template(tweetTemplate)({
        time: timeLabel,
        lines,
        hashtag: tag,
        link
    });

    const twitterUrl =
        "https://twitter.com/intent/tweet?" +
        queryString.stringify({
            text: tweet
        });

    handleTweetIntentClick(undefined, twitterUrl);
    analytics.sendEvent("tweet", "tweeted");
}
