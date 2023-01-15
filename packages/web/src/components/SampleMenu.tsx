import * as React from "react";

import { Menu, MenuItem } from "@blueprintjs/core";

import { samples, samplesForSourceType } from "../samples";
import { SourceType } from "../quicktype";

interface Props {
  onPickSample(sample: string, type: SourceType): void;
}

class MenuExample extends React.Component<Props, {}> {
  sampleList(sourceType: SourceType) {
    const examples = samplesForSourceType(sourceType) || [];
    return examples.map(sample => (
      <MenuItem
        icon="document"
        key={sample}
        onClick={() => this.props.onPickSample(sample, sourceType)}
        text={sample}
      />
    ));
  }
  render() {
    return (
      <Menu>
        {samples.map(
          ([sourceType]) =>
            sourceType === undefined ? null : (
              <div key={sourceType}>
                <MenuItem disabled={true} text={sourceType} />
                {this.sampleList(sourceType)}
              </div>
            )
        )}
      </Menu>
    );
  }
}

export default MenuExample;
