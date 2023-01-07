import * as React from "react";
import { Store, Unsubscribe } from "redux";
import * as _ from "lodash";
import classNames from "classnames";
import { Icon, Tooltip, Position, Tabs, Tab, Button, Callout, Intent } from "@blueprintjs/core";

import {
    defaultTargetLanguages,
    languageNamed,
    TargetLanguage,
    OptionDefinition,
    InferenceFlagName,
    inferenceFlagsObject
} from "quicktype-core";

import { defined } from "../../util";
import * as analytics from "../../analytics";
import { RootState, OptionsPadState, LanguageOptions } from "../../types";
import { setLanguage, setLanguageOptions, setInferenceFlags } from "../../actions";
import * as selector from "../../selectors";
import * as signal from "../../signals";

import "./styles.css";
import { connect } from "react-redux";
import { SourceType } from "../../quicktype";

function sendEvent(name: string, label?: string) {
    analytics.sendEvent("OptionsPad", name, label);
}

interface OptionsPadProps {
    className?: string;
    store: Store<RootState>;
    numberOfOutputFiles: number;
}

interface BooleanOptionProps {
    tip: JSX.Element;
    checked: boolean;
    disabled?: boolean;
    label: string;
    toggle(checked: boolean): void;
}

const BooleanOption = ({ tip, label, checked, toggle, disabled }: BooleanOptionProps) => (
    <Tooltip hoverOpenDelay={500} content={tip} position={Position.LEFT}>
        <label className="bp3-control bp3-switch">
            <input
                type="checkbox"
                checked={checked}
                onChange={e => toggle(e.target.checked)}
                disabled={disabled === undefined ? false : disabled}
            />
            <span className="bp3-control-indicator" />
            {label}
            <Icon icon="help" />
        </label>
    </Tooltip>
);

const DownloadButton = ({
    sourceType,
    onClick
}: {
    sourceType: SourceType;
    onClick: (sourceType: SourceType) => void;
}) => (
    <Button className="copy bp3-fill" onClick={() => onClick(sourceType)}>
        Download Code
    </Button>
);

const ConnectedDownloadButton = connect(
    (state: RootState) => ({
        sourceType: selector.sourceType(state)
    }),
    dispatch => ({
        onClick(sourceType: SourceType) {
            sendEvent("download", sourceType);
            signal.send("DownloadOutput");
        }
    })
)(DownloadButton);

const CopyButton = ({ sourceType, onClick }: { sourceType: SourceType; onClick: (sourceType: SourceType) => void }) => (
    <Button className="copy bp3-fill" onClick={() => onClick(sourceType)}>
        Copy Code
    </Button>
);

const ConnectedCopyButton = connect(
    (state: RootState) => ({
        sourceType: selector.sourceType(state)
    }),
    dispatch => ({
        onClick(sourceType: SourceType) {
            sendEvent("copy", sourceType);
            signal.send("CopyOutput");
        }
    })
)(CopyButton);

class OptionsPad extends React.Component<OptionsPadProps, OptionsPadState> {
    unsubscribe!: Unsubscribe;

    constructor(props: OptionsPadProps) {
        super(props);
    }

    componentDidMount() {
        this.unsubscribe = this.props.store.subscribe(() => {
            this.forceUpdate();
        });
    }

    componentWillUnmount() {
        this.unsubscribe();
    }

    get targetLanguage(): TargetLanguage {
        return defined(languageNamed(this.storeState.language));
    }

    get storeState(): OptionsPadState {
        return this.props.store.getState().optionsPad;
    }

    get languageOptions(): LanguageOptions {
        const state = this.storeState;
        return state.options[state.language];
    }

    get optionsDisabled(): boolean {
        return false;
    }

    setOption<T>(def: OptionDefinition, value: T) {
        this.props.store.dispatch(
            setLanguageOptions(this.storeState.language, { rendererOptions: { [def.name]: value } })
        );
    }

    componentForOption = (def: OptionDefinition) => {
        let { rendererOptions } = this.languageOptions;

        function enumOptionToLabel(option: string) {
            if (!Number.isNaN(Number.parseFloat(option))) {
                // Leave numbers untouched (e.g. "4.1" for Swift version)
                return option;
            }
            return _.startCase(option);
        }

        // Enum options
        if (def.type === String && def.legalValues) {
            return (
                <label className="bp3-label" key={def.name}>
                    {def.description}
                    <div className="bp3-select">
                        <select
                            disabled={this.optionsDisabled}
                            defaultValue={rendererOptions[def.name]}
                            onChange={e => this.setOption(def, e.target.value)}
                        >
                            {def.legalValues.map(val => (
                                <option key={val} value={val}>
                                    {enumOptionToLabel(val)}
                                </option>
                            ))}
                        </select>
                    </div>
                </label>
            );
        } else if (def.type === String) {
            return (
                <label className="bp3-label" key={def.name}>
                    {def.description}
                    <input
                        disabled={this.optionsDisabled}
                        className="bp3-input bp3-fill"
                        type="text"
                        placeholder={def.description}
                        dir="auto"
                        value={rendererOptions[def.name]}
                        onChange={e => {
                            this.setOption(def, e.target.value || def.defaultValue);
                        }}
                    />
                </label>
            );
        } else if (def.type === Boolean) {
            return (
                <label className="bp3-control bp3-switch" key={def.name}>
                    <input
                        disabled={this.optionsDisabled}
                        type="checkbox"
                        checked={rendererOptions[def.name] || false}
                        onChange={e => this.setOption(def, e.target.checked)}
                    />
                    <span className="bp3-control-indicator" />
                    {def.description}
                </label>
            );
        }
        return null;
    };

    setLanguage = (name: string) => {
        const language = defined(languageNamed(name));
        this.props.store.dispatch(setLanguage(language.displayName));
        sendEvent(`select language`, language.displayName);
        analytics.sendUserLanguage(language);
    };

    languageOptionsTab(options: OptionDefinition[], isSchema: boolean): JSX.Element {
        return (
            <div>
                <label className="bp3-label">
                    <div className="bp3-select">
                        <select
                            defaultValue={this.storeState.language}
                            onChange={event => this.setLanguage(event.target.value)}
                        >
                            {defaultTargetLanguages
                                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                                .map(language => (
                                    <option value={language.displayName} key={language.displayName}>
                                        {language.displayName}
                                    </option>
                                ))}
                        </select>
                    </div>
                </label>

                {options.map(this.componentForOption)}

                {isSchema ? null : (
                    <BooleanOption
                        disabled={this.optionsDisabled}
                        label="Make all properties optional"
                        checked={this.languageOptions.allPropertiesOptional}
                        toggle={allPropertiesOptional =>
                            this.props.store.dispatch(
                                setLanguageOptions(this.targetLanguage.displayName, { allPropertiesOptional })
                            )
                        }
                        tip={<span>Make all properties of every type optional.</span>}
                    />
                )}
            </div>
        );
    }

    otherOptionsTab(options: OptionDefinition[], isSchema: boolean) {
        let inferenceOptions: React.ReactNode;
        if (!isSchema) {
            const suppportsIntegerAndBooleanInference = ["C#", "Python"].indexOf(this.storeState.language) !== -1;
            let flagNames: InferenceFlagName[] = [];
            for (const k of Object.keys(inferenceFlagsObject) as InferenceFlagName[]) {
                if (
                    !suppportsIntegerAndBooleanInference &&
                    (k === "inferIntegerStrings" || k === "inferBooleanStrings")
                ) {
                    continue;
                }
                flagNames.push(k);
            }
            flagNames = _.sortBy(flagNames, k => inferenceFlagsObject[k].description);

            inferenceOptions = flagNames.map(k => {
                const explanationLines = inferenceFlagsObject[k].explanation.split("\n");
                const explanationNodes: React.ReactNode[] = [];
                for (const line of explanationLines) {
                    if (explanationNodes.length > 0) {
                        explanationNodes.push(<br />);
                    }
                    explanationNodes.push(line);
                }

                return (
                    <BooleanOption
                        key={k}
                        disabled={this.optionsDisabled}
                        label={inferenceFlagsObject[k].description}
                        checked={this.languageOptions[k]}
                        toggle={value => {
                            const update: Partial<{ [F in InferenceFlagName]: boolean }> = {};
                            update[k] = value;
                            this.props.store.dispatch(setInferenceFlags(update));
                        }}
                        tip={<span>{explanationNodes}</span>}
                    />
                );
            });
        }

        return (
            <div>
                {options.length === 0 ? null : options.map(this.componentForOption)}
                {isSchema ? null : inferenceOptions}
            </div>
        );
    }

    render() {
        const { sourceType } = this.props.store.getState().sourcePad;
        const isSchema = _.includes([SourceType.Schema], sourceType);

        const options = _.chain(this.targetLanguage.optionDefinitions)
            .sortBy(o => o.type === Boolean)
            .groupBy(o => o.kind)
            .value();

        options.primary = options.primary || [];
        options.secondary = options.secondary || [];

        return (
            <div className={classNames("instruments bp3-elevation-2", this.props.className)}>
                <Tabs id="option-tabs">
                    <Tab
                        id="option-tab-language"
                        title="Language"
                        panel={this.languageOptionsTab(options.primary, isSchema)}
                    />
                    {isSchema && options.secondary.length === 0 ? null : (
                        <Tab
                            id="option-tab-inference"
                            title="Other"
                            panel={this.otherOptionsTab(options.secondary, isSchema)}
                        />
                    )}
                </Tabs>
                <div className="no-mobile">
                    {this.props.numberOfOutputFiles > 1 ? <ConnectedDownloadButton /> : <ConnectedCopyButton />}
                </div>

                {!this.optionsDisabled ? null : (
                    <div>
                        <br />
                        <Callout intent={Intent.WARNING}>Sign in to change options</Callout>
                    </div>
                )}
            </div>
        );
    }
}

export default OptionsPad;
