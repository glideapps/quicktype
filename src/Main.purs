module Main
    ( main
    , glueGraphFromJsonConfig
    , urlsFromJsonGrammar
    , intSentinel
    ) where

import Prelude

import IRGraph (IRGraph, regatherClassNames, regatherUnionNames, filterTypes, isEnum)
import Config as Config
import Control.Monad.State (modify)
import Core (Either(..), Error, SourceCode)
import Data.Argonaut.Core (Json)
import Data.Argonaut.Decode (decodeJson) as J
import Data.StrMap as SM
import Data.Maybe (Maybe(..))
import Doc as Doc
import IR (execIR, normalizeGraphOrder, replaceNoInformationWithAnyType)
import IRTypeable (intSentinel) as IRTypeable
import IRTypeable (makeTypes)
import Data.Set as S
import Reykjavik (GlueGraph, irGraphToGlue)
import Options (makeOptionValues)
import Transformations as T
import UrlGrammar (GrammarMap(..), generate)

-- TODO find a better way to rexport these
intSentinel :: String
intSentinel = IRTypeable.intSentinel

graphFromConfig :: Config.Config -> Either Error IRGraph
graphFromConfig config = do
    let samples = Config.topLevelSamples config
    let schemas = Config.topLevelSchemas config

    graph <- normalizeGraphOrder <$> execIR do
        makeTypes samples
        if Config.combineClasses config then T.replaceSimilarClasses else pure unit
        if Config.inferMaps config then T.makeMaps else pure unit
        modify regatherClassNames

        -- We don't regatherClassNames for schemas
        -- TODO Mark, why not? Tests fail if we do.
        makeTypes schemas
        modify regatherUnionNames
        replaceNoInformationWithAnyType
    pure graph

failOnEnum :: IRGraph -> String -> Either Error Unit
failOnEnum graph language =
    let set = filterTypes (\t -> if isEnum t then Just $ S.singleton unit else Nothing) graph
    in
        if S.isEmpty set then
            Right unit
        else
            Left ("Enums are not supported in " <> language <> " yet.")

-- json is a Foreign object whose type is defined in /cli/src/Main.d.ts
main :: Json -> Either Error SourceCode
main json = do
    config <- Config.parseConfig json
    graph <- graphFromConfig config
    if Config.doRender config then
        do
            renderer <- Config.renderer config
            failOnEnum graph (renderer.displayName)
            let optionStrings = Config.rendererOptions config
            let optionValues = makeOptionValues renderer.options optionStrings
            pure $ Doc.runRenderer renderer graph optionValues
        else
            pure "Done."

glueGraphFromJsonConfig :: Json -> Either Error GlueGraph
glueGraphFromJsonConfig json = do
    config <- Config.parseConfig json
    graph <- graphFromConfig config
    pure $ irGraphToGlue graph

urlsFromJsonGrammar :: Json -> Either Error (SM.StrMap (Array String))
urlsFromJsonGrammar json = do
    GrammarMap grammarMap <- J.decodeJson json
    pure $ generate <$> grammarMap
