import { AnyAction } from "redux";
import { defaults } from "lodash";

import { ActionType, SetSourceNodeExpandedPayload, SetSourceStatePayload } from "../actions";
import { defined } from "../util";
import { SourcePadState } from "../types";
import { lookupSample } from "../samples";

const defaultState: SourcePadState = (() => {
  const defaultSample = "welcome.json";
  const sampleInfo = defined(lookupSample(defaultSample));

  return {
    sample: defaultSample,
    name: sampleInfo.name,
    leadingComments: sampleInfo.leadingComments,
    sourceType: sampleInfo.sourceType,
    sources: sampleInfo.sources,
    expandedNodes: [],
    selectedNode: 0
  };
})();

export default function sourcePad(state: SourcePadState = defaultState, action: AnyAction) {
  state = defaults({}, state, defaultState);
  switch (action.type) {
    case ActionType.SetSourceNodeExpanded:
      const node: SetSourceNodeExpandedPayload = action.payload;
      const nodes = state.expandedNodes.filter(i => i !== node.id);
      return {
        ...state,
        expandedNodes: node.expanded ? [...nodes, node.id] : nodes
      };

    case ActionType.SetSourceNodeSelected:
      const id: number = action.payload;
      return {
        ...state,
        selectedNode: id
      };

    case ActionType.SetSourceState:
      let sourceState: SetSourceStatePayload = action.payload;

      // If we're only setting the sample, load it.
      if (sourceState.sample !== undefined && Object.keys(sourceState).length === 1) {
        let sampleInfo = lookupSample(sourceState.sample);
        if (sampleInfo !== undefined) {
          sourceState = {
            sample: sourceState.sample,
            leadingComments: sampleInfo.leadingComments,
            sourceType: sampleInfo.sourceType,
            sources: sampleInfo.sources,
            expandedNodes: [],
            selectedNode: 0
          };
        } else {
          sourceState = {};
        }
      }

      return {
        ...state,
        ...sourceState
      };

    default:
      return state;
  }
}
