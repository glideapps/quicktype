import React, { Component } from 'react';

import Entry from './Entry';
import Button from "@react-mdc/button";
import Dropdown from './Dropdown';
import TabBar from './TabBar';
import browser from "bowser";

import Main from "../../output/Main";
import Samples from "../../output/Samples";

const about_url = "http://blog.quicktype.io/2017/previewing-quicktype";
const mobileClass = (browser.mobile || browser.tablet) ? "mobile" : "";

export default class Sidebar extends Component {
  sendEvent = (name, value) => window.ga("send", "event", "Sidebar", name, value);

  render() {
    return (
        <sidebar className={`mdc-theme--dark mdc-elevation--z1 ${this.props.className}`}>
            <header className="mdc-toolbar mdc-elevation--z2">
                <div className="mdc-toolbar__row">
                <section className="mdc-toolbar__section mdc-toolbar__section--align-start">
                    <a id="logo" className="material-icons mdc-toolbar__icon--menu">radio_button_checked</a>
                    <span className="mdc-toolbar__title">quicktype</span>
                </section>
                <section className="mdc-toolbar__section mdc-toolbar__section--align-end">
                    <a href={about_url} target="_blank" className="material-icons mdc-toolbar__icon--menu">info_outline</a>
                </section>
                </div>
            </header>
            <div className="content">
                <div className="source-dest">
                    <Dropdown
                        selected={this.props.sampleName}
                        entries={Samples.samples}
                        onChange={this.props.onChangeSample}
                        />
                    <Dropdown
                        selected={this.props.rendererName}
                        entries={Main.renderers.map((r) => r.name)}
                        onChange={this.props.onChangeRenderer}
                        />
                </div>

                <Entry
                    name="toplevel"
                    label="Top-level type"
                    value={this.props.topLevelName}
                    onChange={this.props.onChangeTopLevelName} />

                <TabBar
                    name="tabs"
                    tab={this.props.tab}
                    onChange={this.props.tabChanged}
                    />
                
                <div id="button-parent" className={mobileClass}>
                    <div className="cli-hint">
                        <p>Install quicktype locally:</p>
                        <pre>npm i -g quicktype</pre>
                    </div>
                    <Button raised primary>
                        Copy {this.props.rendererName}
                    </Button>
                </div>
            </div>
        </sidebar>
    );
  }
}