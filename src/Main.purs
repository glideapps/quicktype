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

import Language.Renderers as Renderers
import Language.JsonSchema (JSONSchema, jsonSchemaListToIR)

import Data.Argonaut.Core (Json)
import Data.Argonaut.Core (foldJson) as J
import Data.Argonaut.Decode (decodeJson) as J
import Data.Argonaut.Parser (jsonParser) as J
import Data.Array (foldl)
import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.List as L
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.String.Util (singular)
import Data.Tuple (Tuple(..))
import Doc as Doc
import Environment (Environment(..))
import Environment as Env
import UrlGrammar (GrammarMap(..), generate)
import Utils (foldErrorArray, foldErrorStrMap, forStrMap_, mapM, mapStrMapM)
import Control.Monad.Except (except)

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

makeTypeAndUnify :: StrMap (Array Json) -> Either Error IRGraph
makeTypeAndUnify jsonArrayMap = execIR do
    forStrMap_ jsonArrayMap \name jsonArray -> do
        topLevelTypes <- mapM (makeTypeFromJson $ Given name) $ L.fromFoldable jsonArray
        topLevel <- unifyMultipleTypes topLevelTypes
        addTopLevel name topLevel
    replaceSimilarClasses
    makeMaps

makeTypeFromSchemaArrayMap :: StrMap (Array Json) -> Either Error IRGraph
makeTypeFromSchemaArrayMap jsonArrayMap = execIR do
    forStrMap_ jsonArrayMap \name jsonSchemaArray -> do
        schemaArray <- mapM (except <<< J.decodeJson) jsonSchemaArray
        topLevel <- jsonSchemaListToIR (Given name) schemaArray
        addTopLevel name topLevel

renderFromJsonArrayMap :: Pipeline (StrMap (Array Json))
renderFromJsonArrayMap { renderer, input: jsonArrayMap } = do
    graph <- makeTypeAndUnify jsonArrayMap
    normalGraph <- graph # regatherClassNames # regatherUnionNames # normalizeGraphOrder
    pure $ Doc.runRenderer renderer normalGraph
    
renderFromJsonSchemaArrayMap :: Pipeline (StrMap (Array Json))
renderFromJsonSchemaArrayMap { renderer, input: jsonArrayMap } = do
    graph <- makeTypeFromSchemaArrayMap jsonArrayMap
    normalGraph <- normalizeGraphOrder (regatherUnionNames graph)
    pure $ Doc.runRenderer renderer normalGraph

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
