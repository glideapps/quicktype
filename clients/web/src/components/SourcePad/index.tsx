import * as React from "react";
import { ReactText } from "react";

import classNames from "classnames";

import { Store, Unsubscribe } from "redux";
import _ from "lodash";
import { includes } from "lodash";

import JSONLint, { JSONLintResult, JSONLintErrorResult } from "json-lint";

import { defaultTargetLanguages } from "quicktype-core";

import { Position, Popover, Button, Intent, IToastProps, Menu, MenuItem, Tree, ITreeNode } from "@blueprintjs/core";

import { AceEditor } from "./style";

import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-solarized_dark";

import "../../styles/SourcePad.css";

import * as analytics from "../../analytics";
import { Source, Sample, SourceType, sourceTypes } from "../../quicktype";
import SampleMenu from "../SampleMenu";
import Toaster from "../Toaster";
import { lookupSample, samplesForSourceType } from "../../samples";
import { RootState, SourcePadState } from "../../types";
import { setLanguage, setSourceNodeExpanded, setSourceState } from "../../actions";
import { defined } from "../../util";

// import * as browser from "bowser";
const browser = { mobile: false };

function isLintError(result: JSONLintResult): result is JSONLintErrorResult {
    return "error" in result;
}

const humanizedJSONErrors: Record<string, string> = {
    "expecting a comma or a closing": "Missing comma or closing brace",
    "expecting a string for key statement": "Key must be quoted",
    "EOF Error. Expecting closing ']'": "Missing closing ']'",
    "EOF Error, expecting closing '}'": "Missing closing '}'",
    "expecting opening block": "Missing opening brace or square bracket",
    "expecting a value": "Missing value for key",
    "Unexpected End Of Array Error": "Array has an extra comma at the end"
};

function humanizeError(error: string) {
    for (const key of Object.getOwnPropertyNames(humanizedJSONErrors)) {
        if (error.includes(key)) {
            return humanizedJSONErrors[key];
        }
    }
    return error;
}

function nojson(s: string) {
    return s.replace(".json", "");
}

function traverse(sources: Source[], visit: (id: number, s: Source | Sample) => void) {
    let id = 0;
    sources.forEach((source: Source) => {
        visit(id++, source);
        source.samples.forEach((sample: Sample) => visit(id++, sample));
    });
}

interface Props {
    store: Store<RootState>;
}

interface State {
    /// This state may be ahead of the store, pending an update during typing
    state: SourcePadState;
    error?: { line: number; key: string };
}

function isSample(x: Sample | Source | undefined): x is Sample {
    return !!x && "source" in x;
}

function isSource(x: Sample | Source | undefined): x is Source {
    return !!x && "topLevelName" in x;
}

function reformat(json: string): string {
    try {
        return JSON.stringify(JSON.parse(json), null, 2);
    } catch (e) {
        return json;
    }
}

function prettify(source: Source) {
    source.samples = source.samples.map(sample => {
        sample.source = reformat(sample.source);
        return sample;
    });
    return source;
}

class SourcePad extends React.Component<Props, State> {
    unsubscribe!: Unsubscribe;
    editor: any;
    nameEntry!: HTMLInputElement;

    sendEditEventDebounced = _.debounce(() => this.sendEvent("edit source"), 10000);

    public set sources(sources: Source[]) {
        const formatted = sources.map(prettify);
        const numSamples = _(sources)
            .map((s: Source) => s.samples.length)
            .sum();
        this.props.store.dispatch(
            setSourceState({ sources: formatted, sourceType: numSamples > 1 ? SourceType.Multiple : SourceType.JSON })
        );
        this.scrollTop();
    }

    constructor(props: Props) {
        super(props);
        this.state = { state: props.store.getState().sourcePad };
    }

    sendEvent(name: string, label?: string, value?: number) {
        analytics.sendEvent("SourcePad", name, label, value);
    }

    componentDidMount() {
        this.unsubscribe = this.props.store.subscribe(() => {
            const { sourcePad } = this.props.store.getState();
            this.setState({ state: sourcePad }, () => {
                if (sourcePad.sources.length === 0) {
                    this.loadSample();
                }
                this.forceUpdate();
            });
        });

        this.editor.on("paste", (e: any) => {
            const { column, row } = this.editor.selection.selectionAnchor;
            // Rough heuristic
            const wholeSelection = column === 0 && row === 0;
            if (!wholeSelection) {
                return;
            }

            this.sendEvent("paste");
            setImmediate(() => {
                this.nameEntry.select();
                this.scrollTop();
            });
        });
    }

    componentWillUnmount() {
        this.unsubscribe();
    }

    shouldLint(source: string) {
        return source.length < 1024 * 500;
    }

    lint(source: string): JSONLintErrorResult | undefined {
        if (this.shouldLint(source)) {
            const lintResult = JSONLint(source);
            if (isLintError(lintResult)) {
                this.displayJSONError(lintResult.line, lintResult.error);
                return lintResult;
            }
        }

        Toaster.clear();
        this.setState({ error: undefined });

        return undefined;
    }

    displayJSONError = (line: number, message: string) => {
        this.sendEvent("lint error");

        const props: IToastProps = {
            message: humanizeError(message),
            timeout: 30000,
            intent: Intent.DANGER,
            icon: "error"
        };
        if (this.state.error) {
            Toaster.show(props, this.state.error.key);
        } else {
            const error = { key: Toaster.show(props), line };
            this.setState({ error });
        }
    };

    scrollTop = () => {
        this.editor.resize(true);
        this.editor.scrollToLine(0, false, true, () => ({}));
        this.editor.gotoLine(0, 0, true);
    };

    /// Sets the state within the component, which should be broadcast
    /// after a delay. This is where we throttle changes that we don't
    /// want to happen immediately
    // tslint:disable-next-line:member-ordering
    setSourceStateTimer?: number;
    setSourceState(state: Partial<SourcePadState>) {
        if (this.setSourceStateTimer !== undefined) {
            clearTimeout(this.setSourceStateTimer);
            this.setSourceStateTimer = undefined;
        }

        this.setState(
            {
                state: {
                    ...this.state.state,
                    ...state
                }
            },
            () => {
                this.setSourceStateTimer = window.setTimeout(() => {
                    // We also wait a while before attempting to lint
                    const lintError = this.lint(this.selectedSource);
                    // We only set global state if we don't have a lint issue
                    if (lintError === undefined) {
                        this.setSourceStateImmediate(this.state.state);
                    }
                }, 1200);
            }
        );
    }

    setSourceStateImmediate(state: Partial<SourcePadState>) {
        const newState = {
            ...this.state.state,
            ...state
        };
        this.props.store.dispatch(setSourceState(newState));
    }

    loadSample = (name?: string) => {
        const sampleName = name || this.sourceState.sample;
        let sourceInfo = lookupSample(sampleName);

        if (undefined === sourceInfo) {
            Toaster.show({
                message: `${sampleName} not found`,
                intent: Intent.DANGER,
                icon: "error"
            });
            return;
        }

        if (this.state.error) {
            Toaster.dismiss(this.state.error.key);
        }

        let expandedNodes = Array<number>();
        traverse(sourceInfo.sources, (id, s) => {
            if (isSource(s) && s.samples.length > 1) {
                expandedNodes.push(id);
            }
        });

        this.setSourceStateImmediate({
            sample: sampleName,
            sources: sourceInfo.sources,
            sourceType: sourceInfo.sourceType,
            leadingComments: sourceInfo.leadingComments,
            expandedNodes,
            selectedNode: 0
        });
        this.setState({ error: undefined });

        // We have to wait for redux to pass our new source state
        // to accurately resize the editor. This is a hack to get
        // scrollTop at the end of the event queue.
        setImmediate(() => this.scrollTop());
    };

    get selectedName(): string {
        const selected = this.selectedSourceOrSample;
        if (isSample(selected)) {
            return selected.name;
        } else if (isSource(selected)) {
            return selected.topLevelName;
        }
        return "";
    }

    set selectedName(name: string) {
        const id = this.sourceState.selectedNode || 0;
        const selected = this.selectedSourceOrSample;
        if (isSample(selected)) {
            this.setSampleSource(id, _.merge(selected, { name }));
        } else if (isSource(selected)) {
            this.setSource(id, _.merge(selected, { topLevelName: name }));
        }
    }

    get selectedSource(): string {
        const id = this.sourceState.selectedNode;
        if (undefined !== id) {
            const sample = this.getClosestSample(id);
            if (sample) {
                return sample.source;
            }
        }
        return "";
    }

    set selectedSource(source: string) {
        const id = this.sourceState.selectedNode;
        if (undefined !== id) {
            const sample = this.getClosestSample(id);
            if (sample) {
                this.setSampleSource(id, _.merge(sample, { source }));
            }
        }
        this.sendEditEventDebounced();
    }

    get selectedSourceOrSample(): Source | Sample | undefined {
        return this.getSourceOrSample(this.sourceState.selectedNode || 0);
    }

    getSourceOrSample(id: ReactText): Source | Sample | undefined {
        let source: Source | undefined;
        let sample: Sample | undefined;
        this.mapSources(
            this.sourceState.sources,
            id,
            s => (source = s),
            s => (sample = s)
        );
        return sample || source;
    }

    get selectedParent(): { source: Source; id: number } | undefined {
        let source = this.selectedSourceOrSample;
        let id = this.sourceState.selectedNode;

        if (undefined === id || undefined === window.parent) {
            return undefined;
        }

        while (id > 0 && !isSource(source)) {
            id--;
            source = this.getSourceOrSample(id);
        }

        return isSource(source) ? { source, id } : undefined;
    }

    getClosestSample(id: ReactText): Sample | undefined {
        const found = this.getSourceOrSample(id);
        if (isSample(found)) {
            return found;
        } else if (isSource(found)) {
            return found.samples[0];
        }
        return undefined;
    }

    setSource(id: ReactText, source: Source) {
        const sources = this.mapSources(this.sourceState.sources, id, old => _.assign(old, source));
        this.setSourceStateImmediate({ sources, sourceType: this.sourceState.sourceType });
    }

    setSampleSource(id: ReactText, sample: Sample) {
        const sources = this.mapSources(
            this.sourceState.sources,
            id,
            source => {
                // This ID matches a source, not a sample, so we merge this sample
                const sourceSamples = source.samples;
                sourceSamples[0] = sample;
                return _.merge(source, { samples: sourceSamples });
            },
            () => sample
        );
        this.setSourceState({ sources, sourceType: this.sourceState.sourceType });
    }

    mapSources(
        sources: Source[],
        id: ReactText,
        onSource: (s: Source) => Source,
        onSample: (s: Sample) => Sample = x => x
    ): Source[] {
        let ids = 0;
        const child = (sample: Sample) => {
            const thisId = ids++;
            return id === thisId ? onSample(sample) : sample;
        };
        const top = (source: Source): Source => {
            const thisId = ids++;
            const newSource = id === thisId ? onSource(source) : source;
            return _.assign(newSource, { samples: source.samples.map(child) });
        };
        return sources.map(top);
    }

    get tree(): ITreeNode[] {
        let ids = 0;
        const toChild = ({ name, source }: { name?: string; source: string }): ITreeNode => {
            const id = ids++;
            return {
                id,
                label: name || "sample.json",
                icon: "document",
                isSelected: id === this.sourceState.selectedNode
            };
        };
        const toTop = (source: Source): ITreeNode => {
            const id = ids++;
            return {
                id,
                label: source.topLevelName,
                isSelected: id === this.sourceState.selectedNode,
                isExpanded: includes(this.sourceState.expandedNodes, id),
                hasCaret: true,
                childNodes: source.samples.map(toChild)
            };
        };
        return this.sourceState.sources.map(toTop);
    }

    onSourceChange = (source: string) => {
        if (this.selectedSource === source) {
            return;
        }
        this.selectedSource = source;
    };

    addSource = () => {
        this.sendEvent("add source");

        const source: Source = {
            topLevelName: "TopLevel",
            samples: [
                {
                    name: "sample.json",
                    source: "{}"
                }
            ]
        };

        this.setSourceStateImmediate({
            sources: [source, ...this.sourceState.sources],
            sourceType: this.sourceState.sourceType,
            selectedNode: 0,
            expandedNodes: this.sourceState.expandedNodes.map((i: number) => i + 2)
        });
        this.nameEntry.select();
    };

    addSample = () => {
        this.sendEvent("add sample");

        const parent = this.selectedParent;
        const selected = this.selectedSourceOrSample;

        if (undefined === parent) {
            return;
        }

        function incrementName(name: string) {
            if (undefined === parent) {
                return name;
            }
            const basename = nojson(name);
            const [, prefix] = /(.+)(\d+)/.exec(basename) || [null, basename];

            let i = 1;
            while (_.find(parent.source.samples, { name: `${prefix}${i}.json` })) {
                i++;
            }
            return `${prefix}${i}.json`;
        }

        let sample: Sample;
        if (isSample(selected)) {
            sample = {
                name: incrementName(selected.name),
                source: selected.source
            };
        } else {
            sample = {
                name: incrementName("sample.json"),
                source: "{}"
            };
        }

        const newSamples = _.concat(parent.source.samples, [sample]);
        const sources = this.mapSources(this.sourceState.sources, parent.id, source =>
            _.assign(source, { samples: newSamples })
        );
        const expandedNodes = this.sourceState.expandedNodes.map((i: number) => i + 1).concat(parent.id);

        this.setSourceStateImmediate({
            sources,
            sourceType: this.sourceState.sourceType,
            expandedNodes,
            selectedNode: parent.id + newSamples.length
        });

        this.nameEntry.select();
        this.nameEntry.selectionEnd = sample.name.indexOf(".");
    };

    idToSourceIndex(id: number): number {
        let count = id;
        let i = 0;
        for (const source of this.sourceState.sources) {
            if (count === 0) {
                return i;
            }
            i++;
            count = count - 1 - source.samples.length;
        }
        return this.sourceState.sources.length - 1;
    }

    trashSelected = () => {
        this.sendEvent("trash selected");

        const id = this.sourceState.selectedNode;
        if (undefined === id) {
            return;
        }

        const parent = this.selectedParent;
        if (parent) {
            let sources: Source[];
            let selectedNode: ReactText = id;
            const sourceIndex = this.idToSourceIndex(parent.id);
            if (id === parent.id) {
                // We're deleting a source
                sources = this.sourceState.sources.filter((s, i) => i !== sourceIndex);
                selectedNode = Math.max(0, parent.id - 1);
            } else {
                // We're deleting a sample
                const sampleIndex = id - parent.id - 1;
                const newSamples = parent.source.samples.filter((s, i) => i !== sampleIndex);
                sources = this.mapSources(this.sourceState.sources, parent.id, source =>
                    _.assign(source, { samples: newSamples })
                );
                if (newSamples.length === 0) {
                    sources = this.sourceState.sources.filter((s, i) => i !== sourceIndex);
                    selectedNode = Math.max(0, parent.id - 1);
                } else if (sampleIndex >= newSamples.length) {
                    selectedNode = parent.id + sampleIndex;
                }
            }

            if (sources.length === 0) {
                sources = [
                    {
                        topLevelName: "TopLevel",
                        samples: [{ name: "sample.json", source: "{}" }]
                    }
                ];
            }

            this.setSourceStateImmediate({ sources, selectedNode });
        }
    };

    private get storeState(): RootState {
        return this.props.store.getState();
    }

    private get sourceState(): SourcePadState {
        return this.state.state;
    }

    render() {
        return (
            <div
                className={classNames("sidebar bp3-dark", {
                    multisource:
                        !browser.mobile &&
                        includes([SourceType.Multiple, SourceType.Postman], this.sourceState.sourceType)
                })}
            >
                <div className="controls">
                    <label className="bp3-label top-level">
                        Name
                        <input
                            ref={r => (this.nameEntry = r as HTMLInputElement)}
                            className="bp3-input"
                            type="text"
                            placeholder="Name"
                            readOnly={embedded}
                            value={this.selectedName}
                            onChange={e => (this.selectedName = e.target.value)}
                            dir="auto"
                        />
                    </label>
                    <label className="bp3-label source-type">
                        Source type
                        <div className="bp3-select">
                            <select
                                value={this.sourceState.sourceType}
                                onChange={e => {
                                    const sourceType = e.target.value as SourceType;
                                    const sample = defined(samplesForSourceType(sourceType))[0];
                                    this.setSourceStateImmediate({ sample, sources: [], sourceType });
                                    this.sendEvent(`select source type`, sourceType);
                                }}
                            >
                                {sourceTypes.map(t => (
                                    <option key={t} value={t}>
                                        {t}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </label>
                    <Popover
                        className="sample-button"
                        popoverClassName="bp3-minimal"
                        content={
                            <SampleMenu
                                onPickSample={(sample, sourceType) => {
                                    this.sendEvent(`select sample`, sample);
                                    this.loadSample(sample);
                                }}
                            />
                        }
                        position={browser.mobile ? Position.BOTTOM_LEFT : Position.BOTTOM_RIGHT}
                    >
                        <Button icon="folder-close" text={browser.mobile ? this.sourceState.sample : undefined} />
                    </Popover>
                    <Popover
                        className="language-button"
                        popoverClassName="bp3-minimal"
                        content={
                            <Menu>
                                {defaultTargetLanguages.map(language => (
                                    <MenuItem
                                        key={language.displayName}
                                        onClick={() => this.props.store.dispatch(setLanguage(language.displayName))}
                                        text={language.displayName}
                                    />
                                ))}
                            </Menu>
                        }
                        position={Position.BOTTOM}
                    >
                        <Button icon="code" text={this.storeState.optionsPad.language} />
                    </Popover>
                </div>
                <div className="tree-container">
                    <div className="tree-controls bp3-button-group bp3-minimal">
                        <a className="bp3-button bp3-icon-plus" tabIndex={0} role="button" onClick={this.addSource}>
                            Type
                        </a>
                        <a
                            className="bp3-button bp3-icon-plus disabled"
                            tabIndex={0}
                            role="button"
                            onClick={this.addSample}
                        >
                            Sample
                        </a>
                        <a
                            className="bp3-button bp3-icon-trash"
                            tabIndex={0}
                            role="button"
                            onClick={this.trashSelected}
                        />
                    </div>
                    <Tree
                        contents={this.tree}
                        onNodeCollapse={node =>
                            this.props.store.dispatch(setSourceNodeExpanded(node.id as number, false))
                        }
                        onNodeExpand={node => this.props.store.dispatch(setSourceNodeExpanded(node.id as number, true))}
                        onNodeClick={node => {
                            this.scrollTop();
                            this.setSourceStateImmediate({ selectedNode: node.id as number });
                        }}
                    />
                </div>
                <AceEditor
                    ref={() => (this.editor = ace.edit("source"))}
                    mode="json"
                    theme="solarized_dark"
                    name="source"
                    fontSize={14}
                    readOnly={embedded}
                    markers={
                        this.state.error
                            ? [
                                  {
                                      startRow: this.state.error.line - 2,
                                      endRow: this.state.error.line - 2,
                                      startCol: 0,
                                      endCol: 1,
                                      className: "json-error-marker",
                                      type: "fullLine"
                                  }
                              ]
                            : []
                    }
                    showGutter={false}
                    value={this.selectedSource}
                    onChange={this.onSourceChange}
                    editorProps={{ $blockScrolling: Infinity }}
                    setOptions={{ showPrintMargin: false, displayIndentGuides: false }}
                />
            </div>
        );
    }
}

export default SourcePad;
