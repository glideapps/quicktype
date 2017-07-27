import React, { Component } from 'react';

export default class Button extends Component {
    constructor(props) {
        super(props);
        this.state = {
        };
    }

    render() {
        return (
            <button className="mdc-button mdc-button--raised mdc-button--primary">
                Copy C#
            </button>
        );
    }
}