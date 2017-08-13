module Main
    ( renderFromJsonArrayMap
    , renderFromJsonSchemaArrayMap
    , renderFromJsonStringPossiblyAsSchemaInDevelopment
    , renderers
    , urlsFromJsonGrammar
    ) where

import IR
import IRGraph
import Prelude
import Transformations

import CSharp as CSharp
import Data.Argonaut.Core (Json)
import Data.Argonaut.Core (foldJson) as J
import Data.Argonaut.Decode (decodeJson) as J
import Data.Argonaut.Parser (jsonParser) as J
import Data.Array (foldl)
import Data.Either (Either(..), either)
import Data.Foldable (for_)
import Data.List as L
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.String.Util (singular)
import Data.Tuple (Tuple(..))
import Doc as Doc
import Elm as Elm
import Environment (Environment(..))
import Environment as Env
import Golang as Golang
import JsonSchema (JSONSchema, jsonSchemaListToIR)
import JsonSchema as JsonSchema
import UrlGrammar (GrammarMap(..), generate)
import TypeScript as TypeScript
import Utils (foldErrorArray, foldErrorStrMap, forStrMap_, mapM, mapStrMapM)

type Error = String
type SourceCode = String

-- A type representing the input to Pipelines
-- This makes pipelines easier to call from JavaScript
type Input a =
    { input :: a
    , renderer :: Doc.Renderer
    }

type Pipeline a = Input a -> Either Error SourceCode

renderers :: Array Doc.Renderer
renderers = 
    [ TypeScript.renderer
    , Golang.renderer
    , CSharp.renderer
    , Elm.renderer
    , JsonSchema.renderer
    ]

makeTypeFromJson :: Either String String -> Json -> IR IRType
makeTypeFromJson name json =
    J.foldJson
    (\_ -> pure IRNull)
    (\_ -> pure IRBool)
    (\n -> pure IRDouble)
    (\_ -> pure IRString)
    (\arr -> do
        let typeName = singular $ either id id name
        typeList <- mapM (makeTypeFromJson $ Right typeName) $ L.fromFoldable arr
        unifiedType <- unifyMultipleTypes typeList
        pure $ IRArray unifiedType)
    (\obj -> do
        let l1 = SM.toUnfoldable obj :: Array _
        l2 <- mapM toProperty l1
        addClass $ makeClass name $ Map.fromFoldable l2)
    json
    where
        toProperty (Tuple name json) = Tuple name <$> makeTypeFromJson (Right name) json

makeTypeAndUnify :: StrMap (Array Json) -> IRGraph
makeTypeAndUnify jsonArrayMap = execIR do
    forStrMap_ jsonArrayMap \name jsonArray -> do
        topLevelTypes <- mapM (makeTypeFromJson $ Left name) $ L.fromFoldable jsonArray
        topLevel <- unifyMultipleTypes topLevelTypes
        addTopLevel name topLevel
    replaceSimilarClasses
    makeMaps

makeTypeFromSchemaArrayMap :: StrMap (Array JSONSchema) -> Either Error IRGraph
makeTypeFromSchemaArrayMap schemaArrayMap = eitherify $ runIR do
    topLevelOrErrorMap <- mapStrMapM (\n -> jsonSchemaListToIR $ Left n) schemaArrayMap
    case foldErrorStrMap topLevelOrErrorMap of
        Left err -> pure $ Just err
        Right topLevelMap -> do
            for_ (SM.toUnfoldable topLevelMap :: Array _) \(Tuple name topLevel) -> do
                addTopLevel name topLevel
            pure Nothing
    where
        eitherify (Tuple (Just err) _) = Left err
        eitherify (Tuple Nothing g) = Right g

renderFromJsonArrayMap :: Pipeline (StrMap (Array Json))
renderFromJsonArrayMap { renderer, input: jsonArrayMap } =
    jsonArrayMap
    # makeTypeAndUnify
    # regatherClassNames
    # Doc.runRenderer renderer
    # Right

mapStrMapArrayWithError :: forall a b c. (a -> Either b c) -> StrMap (Array a) -> Either b (StrMap (Array c))
mapStrMapArrayWithError f sm =
    let mapWithErrors = SM.mapWithKey (\_ arr -> foldErrorArray $ map f arr) sm
    in
        foldErrorStrMap mapWithErrors

renderFromJsonSchemaArrayMap :: Pipeline (StrMap (Array Json))
renderFromJsonSchemaArrayMap { renderer, input: jsonArrayMap } = do
    schemaArrayMap <- mapStrMapArrayWithError J.decodeJson jsonArrayMap
    graph <- makeTypeFromSchemaArrayMap schemaArrayMap
    graph
        # Doc.runRenderer renderer
        # pure

pipelines :: Environment -> Array (Pipeline (StrMap (Array Json)))
pipelines Development = [renderFromJsonArrayMap]
pipelines Production = [renderFromJsonArrayMap]

firstSuccess :: forall a. Array (Pipeline a) -> Pipeline a
firstSuccess pipes input = foldl takeFirstRight (Left "no pipelines provided") pipes
    where
        takeFirstRight (Right output) _ = Right output
        takeFirstRight _ pipeline = pipeline input

renderFromJsonStringPossiblyAsSchemaInDevelopment :: String -> Pipeline String
renderFromJsonStringPossiblyAsSchemaInDevelopment  topLevelName { renderer, input: jsonString } = do
    obj <- J.jsonParser jsonString
    firstSuccess (pipelines Env.current) { renderer, input: SM.singleton topLevelName [obj] }

urlsFromJsonGrammar :: Json -> Either String (StrMap (Array String))
urlsFromJsonGrammar json =
    case J.decodeJson json of
    Left err -> Left err
    Right (GrammarMap grammarMap) -> Right $ SM.mapWithKey (const generate) grammarMap
