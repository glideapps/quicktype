import styled from "styled-components";

import AceEditorBase from "react-ace";

export const AceEditor = styled(AceEditorBase)`
  height: calc(100vh - 132px) !important;
  width: 100% !important;
  border-radius: 3px;
  border: 1px solid transparent;

  font-family: Consolas, Menlo, monospace;
  font-size: 15px;
  -webkit-font-smoothing: antialiased;

  @media (max-width: 1100px) {
    font-size: 13px;
  }

  .multisource & {
    height: calc(100vh - 132px - 228px) !important;
  }

  &.ace_focus {
    outline: rgba(125, 188, 255, 0.6) auto 2px;
    outline-offset: 2px;
    -moz-outline-radius: 6px;
  }
`;
