import React, { Component } from 'react';

import * as mdc from 'material-components-web/dist/material-components-web.js';
const { MDCSelect } = mdc.select; 

export default class Dropdown extends Component {
   constructor(props) {
    super(props);
    this.state = {
      selected: props.entries[0]
    };
    this.id = `select-${this.props.name}`;
  }

  render() {
    return (
        <div id={this.id} className="mdc-select" role="listbox" tabIndex="0">
            <span className="mdc-select__selected-text">{this.state.selected}</span>
            <div className="mdc-simple-menu mdc-select__menu">
              <ul className="mdc-list mdc-simple-menu__items">
                {this.props.entries.map((label) => {
                  return (
                    <li
                      id={label}
                      className="mdc-list-item"
                      role="option" 
                      tabIndex="0"
                      aria-selected={this.state.selected === label}>
                      {label}
                    </li>
                  );
                })}
              </ul>
            </div>
        </div>
    );
  } 
}