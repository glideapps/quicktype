module Reykjavik.TargetLanguage where

import Prelude

-- TODO make this accurate
type TargetLanguage =
    { displayName :: String
    , names :: Array String
    , extension :: String
    , aceMode :: String
    , optionDefinitions :: Array String
    --, renderGraph :: Unit -- (topLevels: Graph, optionValues: { [name: String]: any }): RenderResult;
    }