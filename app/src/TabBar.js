import React, { Component } from 'react';

import * as mdc from 'material-components-web/dist/material-components-web.js';
const { MDCTabBar } = mdc.tabs;

export default class TabBar extends Component {
  componentDidMount = () => {
    this.tabBar = new MDCTabBar(this.ref);
    this.tabBar.listen('MDCTabBar:change', ({detail: tabs}) => {
        this.props.onChange && this.props.onChange(tabs.activeTabIndex);
    });
   }
 
   render() {
     return (
        <nav
            id={`tab-bar-${this.props.name}`}
            className="mdc-tab-bar"
            ref={(r) => { this.ref = r; }}>

            {["Data", "Code"].map((label, i) =>
                <a
                    key={label}
                    className={i === this.props.tab
                        ? "mdc-tab mdc-tab--active"
                        : "mdc-tab"}>
                    {label}
                </a>
            )}

            <span className="mdc-tab-bar__indicator"></span>
        </nav>
     );
   }   
 }