import React, { Component } from 'react';

import debounce from 'debounce';
import urlParse from 'url-parse';

import Editor from './Editor';
import Entry from './Entry';
import Switch from './Switch';
import Button from './Button';
import Dropdown from './Dropdown';

import Main from "../../output/Main";
import Samples from "../../output/Samples";

import 'brace/mode/json';
import 'brace/theme/solarized_dark';

export default class Sidebar extends Component {
  constructor(props) {
    super(props);

    let { query } = urlParse(window.location.href, true);
    let queryExtension = query.lang || query.l;
    let queryRenderer = queryExtension && Main.renderers.find((r) => r.extension === queryExtension);

    this.state = {
        sample: localStorage["sample"] || Samples.samples[0],
        renderer: queryRenderer || this.getRenderer(),
        source: props.source
    };
  }

  sendEvent = (name, value) => window.ga("send", "event", "Sidebar", name, value);

  componentWillMount() {
    this.changeSample(this.state.sample);
    this.changeRenderer(this.state.renderer.name);
  }

  sourceEdited = (source) => {
    this.setState({ source });
    this.props.onChangeSample(source);
  }

  changeSample = (sample) => {
    try {
      localStorage["sample"] = sample;
    } catch (e) {}

    this.setState({ sample }, () => this.refresh());
  }

  refresh = () => {
    fetch(`/sample/json/${this.state.sample}`)
      .then((data) => data.json())
      .then((data) => {
        let pretty = JSON.stringify(data, null, 2);
        this.setState({ source: pretty });
        this.props.onChangeSample(pretty);
      });
  }

  getRenderer = (name) => {
    let theName = name || localStorage["renderer"] || Main.renderers[0].name;
    return Main.renderers.find((r) => r.name === theName) || Main.renderers[0];
  }

  changeRenderer = (name) => {
    this.sendEvent("changeRenderer", name);

    let renderer = this.getRenderer(name);
    this.setState({ renderer: renderer.name });
    
    try {
      localStorage["renderer"] = renderer.name;
    } catch (e) {}

    this.props.onChangeRenderer(renderer);
  }

  render() {
    return (
        <sidebar className="mdc-elevation--z4">
            <header className="mdc-toolbar mdc-elevation--z2">
                <div className="mdc-toolbar__row">
                <section className="mdc-toolbar__section mdc-toolbar__section--align-start">
                    <a id="logo" href="#" className="material-icons mdc-toolbar__icon--menu">radio_button_checked</a>
                    <span className="mdc-toolbar__title">quicktype</span>
                </section>
                <section className="mdc-toolbar__section mdc-toolbar__section--align-end">
                    <a href="#" className="material-icons mdc-toolbar__icon--menu">info_outline</a>
                </section>
                </div>
            </header>
            <div className="content">
                <div className="source-dest">
                    <Dropdown
                        name="source"
                        entries={Samples.samples}
                        />
                    <Dropdown
                        name="lang"
                        entries={Main.renderers.map((r) => r.name)}
                        />
                </div>

                <Editor
                    className="json"
                    language="json"
                    theme="solarized_dark"
                    onChange={debounce(this.sourceEdited, 300)}
                    value={this.state.source}
                    />

                <Entry name="toplevel" label="Top-level type" value="TopLevel" />
                <Entry name="namespace" label="Namespace" value="QuickType" />

                <Switch name="showHelpers" />

                <div id="button-parent">
                    <Button />
                </div>
            </div>
        </sidebar>
    );
  }
}