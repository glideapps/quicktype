module Main where

import Prelude

import IR
import Doc as Doc
import CSharp as CSharp

import Data.Argonaut.Core (Json, foldJson)
import Data.Argonaut.Parser (jsonParser)
import Data.Array as A
import Data.Either (Either)
import Data.Map as Map
import Data.Set as S
import Data.StrMap as StrMap
import Data.String.Util (singular)
import Data.Tuple (Tuple(..))
import Data.Tuple as Tuple

makeTypeFromJson :: String -> Json -> IR IRType
makeTypeFromJson name json =
    foldJson
    (\_ -> pure IRNull)
    (\_ -> pure IRBool)
    (\_ -> pure IRDouble)
    (\_ -> pure IRString)
    (\arr -> do
        let typeName = singular name
        IRArray <$> A.foldM (unify typeName) IRNothing arr)
    (\obj -> do
        let l1 = StrMap.toUnfoldable obj
        l2 <- mapM toProperty l1
        addClass $ IRClassData { names: S.singleton name, properties: Map.fromFoldable l2 })
    json
    where
        unify typeName t1 j2 = makeTypeFromJson typeName j2 >>= unifyTypes t1
        toProperty (Tuple name json) = Tuple.Tuple name <$> makeTypeFromJson name json

makeTypeAndUnify :: String -> Json -> IRGraph
makeTypeAndUnify name json = runIR do
    topLevel <- makeTypeFromJson name json
    replaceSimilarClasses

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> makeTypeAndUnify "TopLevel"
    <#> (\g -> CSharp.renderer.render g (classesInGraph g))
    <#> Doc.render
