import React, { Component } from 'react';

export default class Switch extends Component {
    constructor(props) {
        super(props);
        this.state = {
        };
        this.id = `switch-${this.props.name}`;
    }

    render() {
        return (
            <div>
                <div className="mdc-switch">
                    <input type="checkbox" id={this.id} className="mdc-switch__native-control" />
                    <div className="mdc-switch__background">
                    <div className="mdc-switch__knob"></div>
                    </div>
                </div>
                <label htmlFor={this.id} className="mdc-switch-label mdc-theme--text-secondary-on-primary">
                    &nbsp;&nbsp;Include to/from JSON helpers
                </label>
            </div>
        );
    }
}