module Main
    ( renderFromJsonArray
    , renderFromJsonSchemaArray
    , renderFromJsonStringPossiblyAsSchemaInDevelopment
    , renderers
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
import Data.Either (Either(..))
import Data.List (List)
import Data.List as L
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set as S
import Data.StrMap as StrMap
import Data.String.Util (singular)
import Data.Tuple (Tuple(..))
import Doc as Doc
import Elm as Elm
import Environment (Environment(..))
import Environment as Env
import Golang as Golang
import JsonSchema (JSONSchema, jsonSchemaListToIR)
import JsonSchema as JsonSchema

import TypeScript as TypeScript
import Math (round)

import Utils (foldError, mapM)

type Error = String
type SourceCode = String

-- A type representing the input to Pipelines
-- This makes pipelines easier to call from JavaScript
type Input a =
    { input :: a
    , renderer :: Doc.Renderer
    , topLevelName :: String
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

makeTypeFromJson :: String -> Json -> IR IRType
makeTypeFromJson name json =
    J.foldJson
    (\_ -> pure IRNull)
    (\_ -> pure IRBool)
    (\n -> pure IRDouble)
    (\_ -> pure IRString)
    (\arr -> do
        let typeName = singular name
        typeList <- mapM (makeTypeFromJson name) $ L.fromFoldable arr
        unifiedType <- unifyMultipleTypes typeList
        pure $ IRArray unifiedType)
    (\obj -> do
        let l1 = StrMap.toUnfoldable obj
        l2 <- mapM toProperty l1
        addClass $ IRClassData { names: S.singleton name, properties: Map.fromFoldable l2 })
    json
    where
        toProperty (Tuple name json) = Tuple name <$> makeTypeFromJson name json

makeTypeAndUnify :: String -> Array Json -> IRGraph
makeTypeAndUnify name jsonArray = execIR do
    topLevelTypes <- mapM (makeTypeFromJson name) $ L.fromFoldable jsonArray
    topLevel <- unifyMultipleTypes topLevelTypes
    setTopLevel topLevel
    replaceSimilarClasses
    makeMaps

irFromError :: String -> IR IRType
irFromError err = do
    addClass $ IRClassData { names: S.singleton err, properties: Map.empty }

makeTypeFromSchemaList :: String -> List JSONSchema -> Either Error IRGraph
makeTypeFromSchemaList name schemaList = eitherify $ runIR do
    topLevelOrError <- jsonSchemaListToIR "TopLevel" schemaList
    case topLevelOrError of
        Left err -> pure $ Just err
        Right topLevel -> do
            setTopLevel topLevel
            pure Nothing
    where
        eitherify (Tuple (Just err) _) = Left err
        eitherify (Tuple Nothing g) = Right g

renderFromJsonArray :: Pipeline (Array Json)
renderFromJsonArray { renderer, input: jsonArray, topLevelName: topLevelNameGiven } =
    let topLevelName = renderer.transforms.topLevelNameFromGiven topLevelNameGiven
    in
        jsonArray
        # makeTypeAndUnify topLevelName
        # regatherClassNames
        # Doc.runRenderer renderer topLevelNameGiven
        # Right

renderFromJsonSchemaArray :: Pipeline (Array Json)
renderFromJsonSchemaArray { renderer, input: jsonArray, topLevelName: topLevelNameGiven } = 
    let topLevelName = renderer.transforms.topLevelNameFromGiven topLevelNameGiven
    in do
        schemaList <- foldError $ map J.decodeJson jsonArray
        graph <- makeTypeFromSchemaList topLevelName schemaList
        graph
            # Doc.runRenderer renderer topLevelNameGiven
            # pure

pipelines :: Environment -> Array (Pipeline (Array Json))
pipelines Development = [renderFromJsonArray]
pipelines Production = [renderFromJsonArray]

firstSuccess :: forall a. Array (Pipeline a) -> Pipeline a
firstSuccess pipes input = foldl takeFirstRight (Left "no pipelines provided") pipes
    where
        takeFirstRight (Right output) _ = Right output
        takeFirstRight _ pipeline = pipeline input

renderFromJsonStringPossiblyAsSchemaInDevelopment :: Pipeline String
renderFromJsonStringPossiblyAsSchemaInDevelopment { renderer, input: jsonString, topLevelName } = do
    obj <- J.jsonParser jsonString
    firstSuccess (pipelines Env.current) { renderer, input: [obj], topLevelName }