import React, { Component } from 'react';

import * as mdc from 'material-components-web/dist/material-components-web.js';
const { MDCSnackbar } = mdc.snackbar; 

export default class Snackbar extends Component {
   constructor(props) {
    super(props);
    this.state = {
    };
    this.id = `entry-${props.name}`;
  }

  show = (options) => {
    const snackbar = new MDCSnackbar(document.querySelector(`#${this.id}`));
    snackbar.show(options);
  }

  render() {
    return (
        <div id={this.id}
            className="mdc-snackbar"
            aria-live="assertive"
            aria-atomic="true"
            aria-hidden="true">
            <div className="mdc-snackbar__text"></div>
            <div className="mdc-snackbar__action-wrapper">
                <button type="button" className="mdc-button mdc-snackbar__action-button"></button>
            </div>
        </div>
    );
  }   
}