module Main where

import IR
import Prelude
import Types

import CSharp (renderer)
import CSharp as CSharp
import Control.Plus (empty)
import Data.Argonaut.Core (Json, foldJson, isString)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either)
import Data.Either.Nested (in1)
import Data.Foldable (find)
import Data.Foldable (for_)
import Data.List (List(..), fromFoldable, length, nub, partition, (:))
import Data.List as L
import Data.List.Types (List(..))
import Data.Map (Map, lookup, mapWithKey, toUnfoldable)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set (Set, insert)
import Data.Set as S
import Data.StrMap as StrMap
import Data.String.Util (singular)
import Data.Tuple (Tuple(..))
import Data.Tuple as Tuple
import Doc (Doc)
import Doc as Doc
import Swift as Swift

lookupOrDefault :: forall k v. Ord k => v -> k -> Map.Map k v -> v
lookupOrDefault default key m =
    case Map.lookup key m of
    Nothing -> default
    Just x -> x

-- FIXME: this is ugly and inefficient
unionWithDefault :: forall k v. Ord k => (v -> v -> v) -> v -> Map.Map k v -> Map.Map k v -> Map.Map k v
unionWithDefault unifier default m1 m2 =
    let allKeys = L.fromFoldable $ S.union (S.fromFoldable $ Map.keys m1) (S.fromFoldable $ Map.keys m2)
        valueFor k = (unifier (lookupOrDefault default k m1) (lookupOrDefault default k m2))
        kvps = map (\k -> Tuple.Tuple k (valueFor k)) allKeys
    in
        Map.fromFoldable kvps

unifyClasses :: IRClassData -> IRClassData -> IRClassData
unifyClasses (IRClassData na pa) (IRClassData nb pb) =
    IRClassData na (unionWithDefault unifyTypesWithNull IRNothing pa pb)

removeElement :: forall a. Ord a => (a -> Boolean) -> S.Set a -> { element :: Maybe a, rest :: S.Set a }
removeElement p s =
    let element = (find p s)
    in
        case element of
            Just x -> { element: element, rest: S.difference s (S.delete x s) }
            Nothing -> { element: element, rest: s }

isArray :: IRType -> Boolean
isArray (IRArray _) = true
isArray _ = false

isClass :: IRType -> Boolean
isClass (IRClass _) = true
isClass _ = false

unifyMaybes :: Maybe IRType -> Maybe IRType -> IRType
unifyMaybes Nothing Nothing = IRNothing
unifyMaybes (Just a) Nothing = a
unifyMaybes Nothing (Just b) = b
unifyMaybes (Just a) (Just b) = unifyTypes a b

setFromType :: IRType -> S.Set IRType
setFromType IRNothing = S.empty
setFromType x = S.singleton x

decomposeTypeSet :: S.Set IRType -> { maybeArray :: Maybe IRType, maybeClass :: Maybe IRType, rest :: S.Set IRType }
decomposeTypeSet s =
    let { element: maybeArray, rest: rest } = removeElement isArray s
        { element: maybeClass, rest: rest } = removeElement isClass rest
    in
        { maybeArray, maybeClass, rest }

unifyUnion :: S.Set IRType -> S.Set IRType -> S.Set IRType
unifyUnion sa sb =
    let { maybeArray: arrayA, maybeClass: classA, rest: sa } = decomposeTypeSet sa
        { maybeArray: arrayB, maybeClass: classB, rest: sb } = decomposeTypeSet sb
        unifiedArray = setFromType $ unifyMaybes arrayA arrayB
        unifiedClasses = setFromType $ unifyMaybes classA classB
    in
        S.unions [sa, sb, unifiedArray, unifiedClasses]

unifyTypes :: IRType -> IRType -> IRType
unifyTypes IRNothing x = x
unifyTypes x IRNothing = x
unifyTypes (IRArray a) (IRArray b) = IRArray (unifyTypes a b)
unifyTypes (IRClass a) (IRClass b) = IRClass (unifyClasses a b)
unifyTypes (IRUnion a) (IRUnion b) = IRUnion (unifyUnion a b)
unifyTypes (IRUnion a) b = IRUnion (unifyUnion a (S.singleton b))
unifyTypes a (IRUnion b) = IRUnion (unifyUnion (S.singleton a) b)
unifyTypes a b = if a == b then a else IRUnion (S.fromFoldable [a, b])

nullifyNothing :: IRType -> IRType
nullifyNothing IRNothing = IRNull
nullifyNothing x = x

unifyTypesWithNull :: IRType -> IRType -> IRType
unifyTypesWithNull IRNothing IRNothing = IRNothing
unifyTypesWithNull a b = unifyTypes (nullifyNothing a) (nullifyNothing b)

makeTypeFromJson :: String -> Json -> IRType
makeTypeFromJson name json = foldJson
    (const IRNull)
    (const IRBool)
    (const IRDouble)
    (const IRString)
    (\arr -> let typeName = singular name
        in
            IRArray (L.foldl (\t j -> unifyTypes t (makeTypeFromJson typeName j)) IRNothing arr))
    fromJObject
    json
    where
        fromJObject obj = IRClass (IRClassData name (Map.fromFoldable $ StrMap.foldMap toProperty obj))
        toProperty name json = L.singleton $ Tuple.Tuple name (makeTypeFromJson name json)

gatherClassesFromType :: IRType -> L.List IRClassData
gatherClassesFromType = case _ of 
    IRClass cls@(IRClassData _ properties) -> cls : L.concatMap gatherClassesFromType (Map.values properties)
    IRArray t -> gatherClassesFromType t
    IRUnion s -> L.concatMap gatherClassesFromType (L.fromFoldable s)
    _ -> empty

matchingProperties :: forall v. Eq v => Map.Map String v -> Map.Map String v -> Map.Map String v
matchingProperties ma mb =
    Map.fromFoldable (L.concatMap getFromB (Map.toUnfoldable ma))
    where
        getFromB (Tuple.Tuple k va) =
            case Map.lookup k mb of
            Just vb -> if va == vb then Tuple.Tuple k vb : L.Nil else L.Nil
            Nothing -> L.Nil

propertiesSimilar :: forall v. Eq v => Map.Map String v -> Map.Map String v -> Boolean
propertiesSimilar pa pb =
    let aInB = Map.size $ matchingProperties pa pb
        bInA = Map.size $ matchingProperties pb pa
    in
        (aInB * 4 >= (Map.size pa) * 3) && (bInA * 4 >= (Map.size pb) * 3)

similarClasses :: L.List IRClassData -> { classes :: S.Set IRClassData, replacements :: Map.Map IRClassData IRClassData }
similarClasses L.Nil = { classes: S.empty, replacements: Map.empty }
similarClasses (thisClass@(IRClassData name properties) : rest) =
    let { yes: similar, no: others } = L.partition isSimilar rest
        recursiveResult@{ classes, replacements } = similarClasses others
    in
        if L.length similar == 0 then
            recursiveResult
        else
            let unified = L.foldl unifyClasses thisClass similar
                newReplacements = Map.fromFoldable (map (\c -> Tuple.Tuple c unified) (thisClass : similar))
            in
                { classes: S.insert unified classes, replacements: Map.union replacements newReplacements  }         
    where isSimilar (IRClassData _ p) = propertiesSimilar p properties

replaceClasses :: (Map.Map IRClassData IRClassData) -> IRType -> IRType
replaceClasses m t@(IRClass c@(IRClassData name properties)) =
    case Map.lookup c m of
    Nothing -> IRClass (IRClassData name (Map.mapWithKey (\n t -> replaceClasses m t) properties))
    Just replacement -> IRClass replacement
replaceClasses m (IRArray t) = IRArray (replaceClasses m t)
replaceClasses m (IRUnion s) = IRUnion (S.map (replaceClasses m) s)
replaceClasses _ t = t

replaceSimilarClasses :: IRType -> IRType
replaceSimilarClasses t =
    let { classes, replacements } = similarClasses (gatherClassesFromType t)
    in
        replaceClasses replacements t

jsonToCSharp :: String -> Either String String
jsonToCSharp json =
    jsonParser json
    <#> makeTypeFromJson "TopLevel"
    <#> replaceSimilarClasses
    <#> gatherClassesFromType
    <#> L.nub
    <#> CSharp.renderer.render
    <#> Doc.render
