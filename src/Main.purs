module Main
    ( main
    , renderers
    , urlsFromJsonGrammar
    , intSentinel
    ) where

import Core
import IR
import IRGraph

import Config as Config
import Control.Monad.State (modify)
import Data.Argonaut.Core (Json)
import Data.Argonaut.Decode (decodeJson) as J
import Data.StrMap as SM
import Doc as Doc
import IRTypeable (class IRTypeable, makeTypes)
import IRTypeable (intSentinel) as IRTypeable
import Language.Renderers as Renderers
import Transformations as T
import UrlGrammar (GrammarMap(..), generate)

-- TODO find a better way to rexport these
intSentinel :: String
intSentinel = IRTypeable.intSentinel

renderers :: Array Doc.Renderer
renderers = Renderers.all

-- json is a Foreign object whose type is defined in /cli/src/Main.d.ts
main :: Json -> Either Error SourceCode
main json = do
    config <- Config.parseConfig json

    let samples = Config.topLevelSamples config
    let schemas = Config.topLevelSchemas config

    renderer <- Config.renderer config

    graph <- normalizeGraphOrder =<< execIR do
        makeTypes samples
        T.replaceSimilarClasses
        T.makeMaps
        modify regatherClassNames

        -- We don't regatherClassNames for schemas
        -- TODO Mark, why not? Tests fail if we do.
        makeTypes schemas
        modify regatherUnionNames

    pure $ Doc.runRenderer renderer graph

urlsFromJsonGrammar :: Json -> Either Error (SM.StrMap (Array String))
urlsFromJsonGrammar json = do
    GrammarMap grammarMap <- J.decodeJson json
    pure $ generate <$> grammarMap
