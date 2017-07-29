module Main where

import IR
import IRGraph
import Prelude
import Transformations

import Environment (Environment(..))
import Environment as Env

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
import Golang as Golang
import JsonSchema (JSONSchema, jsonSchemaToIR)
import JsonSchema as JsonSchema
import Math (round)
import Utils (mapM)

type Error = String

type Pipeline = Doc.Renderer -> String -> Either Error String

renderers :: Array Doc.Renderer
renderers = [CSharp.renderer, Golang.renderer, JsonSchema.renderer]

makeTypeFromJson :: String -> Json -> IR IRType
makeTypeFromJson name json =
    J.foldJson
    (\_ -> pure IRNull)
    (\_ -> pure IRBool)
    (\n -> pure if round n == n then IRInteger else IRDouble)
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

jsonPipeline :: Pipeline
jsonPipeline renderer json =
    json
    # J.jsonParser
    <#> makeTypeAndUnify "TopLevel"
    <#> regatherClassNames
    <#> Doc.runRenderer renderer

jsonSchemaPipeline :: Pipeline
jsonSchemaPipeline renderer json = do
    obj <- J.jsonParser json
    schema <- J.decodeJson obj
    graph <- makeTypeFromSchema "TopLevel" schema
    graph
        # regatherClassNames
        # Doc.runRenderer renderer
        # pure

pipelines :: Environment -> Array Pipeline
pipelines Development = [jsonSchemaPipeline, jsonPipeline]
pipelines Production = [jsonPipeline]

firstSuccess :: Array Pipeline -> Pipeline
firstSuccess pipes renderer json = foldl takeFirstRight (Left "no pipelines provided") pipes
    where
        takeFirstRight (Right output) _ = Right output
        takeFirstRight _ pipeline = pipeline renderer json

renderForUI :: Pipeline
renderForUI = firstSuccess (pipelines Env.current)