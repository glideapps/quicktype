module Main (main, renderers, urlsFromJsonGrammar) where

import Core

import IR
import IRGraph
import Transformations as T

import Config as Config

import Control.Monad.State (modify)
import Data.Argonaut.Core (Json)
import Data.Argonaut.Core (foldJson) as J
import Data.Argonaut.Decode (decodeJson) as J

import Data.Either (Either)

import Data.List as L
import Data.Map (Map)
import Data.Map as Map

import Data.StrMap as SM
import Data.String.Util (singular)
import Data.Traversable (traverse)
import Data.Tuple (Tuple(..))

import Doc as Doc
import Language.JsonSchema (JSONSchema, jsonSchemaListToIR)
import Language.Renderers as Renderers
import UrlGrammar (GrammarMap(..), generate)
import Utils (forMapM_, mapM)

-- json is a Foreign object whose type is defined in /cli/src/Main.d.ts
main :: Json -> Either Error SourceCode
main json = do
    config <- Config.parseConfig json

    let samples = Config.topLevelSamples config
    let schemas = Config.topLevelSchemas config

    renderer <- Config.renderer config

    graph <- normalizeGraphOrder =<< execIR do
        makeTypesFromSamples samples
        T.replaceSimilarClasses
        T.makeMaps
        modify regatherClassNames

        -- We don't regatherClassNames for schemas
        makeTypesFromSchemas schemas
        modify regatherUnionNames

    pure $ Doc.runRenderer renderer graph

makeTypesFromSamples :: Map Name (Array Json) -> IR Unit
makeTypesFromSamples jsonArrayMap = do
    forMapM_ jsonArrayMap \name jsonArray -> do
        topLevelTypes <- traverse (makeTypeFromJson $ Given name) jsonArray
        topLevel <- unifyMultipleTypes $ L.fromFoldable topLevelTypes
        addTopLevel name topLevel

makeTypesFromSchemas :: Map Name JSONSchema -> IR Unit
makeTypesFromSchemas schemaMap = do
    forMapM_ schemaMap \name schema -> do
        topLevel <- jsonSchemaListToIR (Given name) [schema]
        addTopLevel name topLevel

renderers :: Array Doc.Renderer
renderers = Renderers.all

makeTypeFromJson :: Named String -> Json -> IR IRType
makeTypeFromJson name json =
    J.foldJson
    (\_ -> pure IRNull)
    (\_ -> pure IRBool)
    (\n -> pure IRDouble)
    (\_ -> pure IRString)
    (\arr -> do
        let typeName = singular $ namedValue name
        typeList <- mapM (makeTypeFromJson $ Inferred typeName) $ L.fromFoldable arr
        unifiedType <- unifyMultipleTypes typeList
        pure $ IRArray unifiedType)
    (\obj -> do
        let l1 = SM.toUnfoldable obj :: Array _
        l2 <- mapM toProperty l1
        addClass $ makeClass name $ Map.fromFoldable l2)
    json
    where
        toProperty (Tuple name json) = Tuple name <$> makeTypeFromJson (Inferred name) json

urlsFromJsonGrammar :: Json -> Either Error (SM.StrMap (Array String))
urlsFromJsonGrammar json = do
    GrammarMap grammarMap <- J.decodeJson json
    pure $ generate <$> grammarMap
