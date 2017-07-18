module Main where

import IR
import Prelude
import Types

import CSharp (renderer)
import CSharp as CSharp
import Control.Plus (empty)
import Control.Monad.State
import Control.Monad.State.Class
import Data.Argonaut.Core (JArray, JBoolean, JNull, JNumber, JString, Json, JObject, foldJson, isString)
import Data.Argonaut.Parser (jsonParser)
import Data.Array as A
import Data.Either (Either)
import Data.Either.Nested (in1)
import Data.Foldable (find, for_, all, any)
import Data.List (List(..), fromFoldable, length, nub, partition, (:))
import Data.List as L
import Data.List.Types (List(..))
import Data.Map (Map, lookup, mapWithKey, toUnfoldable)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set (Set, insert, member)
import Data.Set as S
import Data.StrMap as StrMap
import Data.String.Util (singular)
import Data.Tuple (Tuple(..))
import Data.Tuple as Tuple
import Doc (Doc)
import Doc as Doc
import Swift as Swift

makeTypeFromJson :: String -> Json -> State IRGraph IRType
makeTypeFromJson name json =
    foldJson
    (\_ -> pure IRNull)
    (\_ -> pure IRBool)
    (\_ -> pure IRDouble)
    (\_ -> pure IRString)
    (\arr ->
        do
            let typeName = singular name
            unified <- A.foldM (unify typeName) IRNothing arr
            pure $ IRArray unified)
    (\obj ->
        do
            let l1 = StrMap.toUnfoldable obj
            l2 <- mapM toProperty l1
            addClass $ IRClassData { names: (S.singleton name), properties: Map.fromFoldable l2 })
    json
    where
        unify typeName t1 j2 =
            do
                t2 <- makeTypeFromJson typeName j2
                unifyTypes t1 t2
        toProperty :: Tuple String Json -> State IRGraph (Tuple String IRType)
        toProperty (Tuple name json) =
            do
                t <- makeTypeFromJson name json
                pure $ Tuple.Tuple name t

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> (\j -> execState (makeTypeFromJson "TopLevel" j) emptyGraph)
    <#> (\g -> execState replaceSimilarClasses g)
    <#> (\g -> CSharp.renderer.render g (classesInGraph g))
    <#> Doc.render
