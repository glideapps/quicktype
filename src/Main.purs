module Main
    ( renderFromJson
    , renderFromJsonSchema
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
import Data.Array as A
import Data.Either (Either(..))
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
import JsonSchema (JSONSchema, jsonSchemaToIR)
import JsonSchema as JsonSchema
import Utils (mapM)

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
renderers = [CSharp.renderer, Golang.renderer, Elm.renderer, JsonSchema.renderer]

makeTypeFromJson :: String -> Json -> IR IRType
makeTypeFromJson name json =
    J.foldJson
    (\_ -> pure IRNull)
    (\_ -> pure IRBool)
    (\n -> pure IRDouble)
    (\_ -> pure IRString)
    (\arr -> do
        let typeName = singular name
        IRArray <$> A.foldRecM (unify typeName) IRNothing arr)
    (\obj -> do
        let l1 = StrMap.toUnfoldable obj
        l2 <- mapM toProperty l1
        addClass $ IRClassData { names: S.singleton name, properties: Map.fromFoldable l2 })
    json
    where
        unify typeName t1 j2 = makeTypeFromJson typeName j2 >>= unifyTypes t1
        toProperty (Tuple name json) = Tuple name <$> makeTypeFromJson name json

makeTypeAndUnify :: String -> Json -> IRGraph
makeTypeAndUnify name json = execIR do
    topLevel <- makeTypeFromJson name json
    setTopLevel topLevel
    replaceSimilarClasses
    makeMaps

irFromError :: String -> IR IRType
irFromError err = do
    addClass $ IRClassData { names: S.singleton err, properties: Map.empty }

makeTypeFromSchema :: String -> JSONSchema -> Either Error IRGraph
makeTypeFromSchema name schema = eitherify $ runIR do
    topLevelOrError <- jsonSchemaToIR schema "TopLevel" schema
    case topLevelOrError of
        Left err -> pure $ Just err
        Right topLevel -> do
            setTopLevel topLevel
            pure Nothing
    where
        eitherify (Tuple (Just err) _) = Left err
        eitherify (Tuple Nothing g) = Right g

renderFromJson :: Pipeline Json
renderFromJson { renderer, input: json, topLevelName: topLevelNameGiven } =
    let topLevelName = renderer.transforms.topLevelNameFromGiven topLevelNameGiven
    in
        json
        # makeTypeAndUnify topLevelName
        # regatherClassNames
        # Doc.runRenderer renderer topLevelNameGiven
        # Right

renderFromJsonSchema :: Pipeline Json
renderFromJsonSchema { renderer, input: json, topLevelName: topLevelNameGiven } = 
    let topLevelName = renderer.transforms.topLevelNameFromGiven topLevelNameGiven
    in do
        schema <- J.decodeJson json
        graph <- makeTypeFromSchema topLevelName schema
        graph
            # Doc.runRenderer renderer topLevelNameGiven
            # pure

pipelines :: Environment -> Array (Pipeline Json)
pipelines Development = [renderFromJson]
pipelines Production = [renderFromJson]

firstSuccess :: forall a. Array (Pipeline a) -> Pipeline a
firstSuccess pipes input = foldl takeFirstRight (Left "no pipelines provided") pipes
    where
        takeFirstRight (Right output) _ = Right output
        takeFirstRight _ pipeline = pipeline input

renderFromJsonStringPossiblyAsSchemaInDevelopment :: Pipeline String
renderFromJsonStringPossiblyAsSchemaInDevelopment { renderer, input: jsonString, topLevelName } = do
    obj <- J.jsonParser jsonString
    firstSuccess (pipelines Env.current) { renderer, input: obj, topLevelName }