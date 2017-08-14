module IRGraph
    ( IRGraph(..)
    , Named(..)
    , namedValue
    , unifyNamed
    , mapToInferred
    , IRClassData(..)
    , IRType(..)
    , IRUnionRep(..)
    , irUnion_Nothing 
    , irUnion_Null
    , irUnion_Integer
    , irUnion_Double
    , irUnion_Bool
    , irUnion_String
    , unionToSet
    , Entry(..)
    , makeClass
    , emptyGraph
    , followIndex
    , getClassFromGraph
    , nullifyNothing
    , nullableFromSet
    , canBeNull
    , isArray
    , isClass
    , isMap
    , matchingProperties
    , mapClasses
    , classesInGraph
    , regatherClassNames
    , regatherUnionNames
    , filterTypes
    , emptyUnion
    ) where

import Prelude

import Data.Foldable (all)
import Data.Int.Bits as Bits
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromJust, maybe, fromMaybe)
import Data.Sequence as Seq
import Data.Set (Set)
import Data.Set as S
import Data.String.Util (singular)
import Data.Tuple (Tuple(..))
import Data.Tuple as T
import Partial.Unsafe (unsafePartial)

data Entry
    = NoType
    | Class IRClassData
    | Redirect Int

newtype IRGraph = IRGraph { classes :: Seq.Seq Entry, toplevels :: Map String IRType }

-- Explicitly given names always take precedence over inferred ones.
data Named a
    = Given a
    | Inferred a

updateGiven :: forall a b. (Maybe a -> b) -> Named a -> Named b
updateGiven f (Given x) = Given $ f $ Just x
updateGiven f _ = Given $ f Nothing

updateInferred :: forall a. (a -> a) -> Named a -> Named a
updateInferred f (Inferred x) = Inferred $ f x
updateInferred _ given = given

namedValue :: forall a. Named a -> a
namedValue (Given x) = x
namedValue (Inferred x) = x

mapToInferred :: forall a b. (a -> b) -> Named a -> Named b
mapToInferred f n = Inferred $ f $ namedValue n

unifyNamed :: forall a. (a -> a -> a) -> Named a -> Named a -> Named a
unifyNamed f (Given ga) (Given gb) = Given $ f ga gb
unifyNamed f a@(Given _) _ = a
unifyNamed f _ b@(Given _) = b
unifyNamed f (Inferred ia) (Inferred ib) = Inferred $ f ia ib

instance functorNamed :: Functor Named where
    map f (Given x) = Given $ f x
    map f (Inferred x) = Inferred $ f x

newtype IRClassData = IRClassData { names :: Named (Set String), properties :: Map String IRType }

newtype IRUnionRep = IRUnionRep { names :: Named (Set String), primitives :: Int, arrayType :: Maybe IRType, classRef :: Maybe Int, mapType :: Maybe IRType }

irUnion_Nothing = 1
irUnion_Null = 2
irUnion_Integer = 4
irUnion_Double = 8
irUnion_Bool = 16
irUnion_String = 32

data IRType
    -- FIXME: IRNothing should never appear in proper types
    = IRNothing
    | IRNull
    | IRInteger
    | IRDouble
    | IRBool
    | IRString
    | IRArray IRType
    | IRClass Int
    | IRMap IRType
    | IRUnion IRUnionRep

derive instance eqNamed :: Eq a => Eq (Named a)
derive instance ordNamed :: Ord a => Ord (Named a)
derive instance eqEntry :: Eq Entry
derive instance eqIRType :: Eq IRType
derive instance ordIRType :: Ord IRType
derive instance eqIRClassData :: Eq IRClassData
derive instance ordIRClassData :: Ord IRClassData
derive instance eqIRUnionRep :: Eq IRUnionRep
derive instance ordIRUnionRep :: Ord IRUnionRep

makeClass :: Named String -> Map String IRType -> IRClassData
makeClass name properties =
    IRClassData { names: map S.singleton name, properties }

emptyGraph :: IRGraph
emptyGraph = IRGraph { classes: Seq.empty, toplevels: M.empty }

followIndex :: IRGraph -> Int -> Tuple Int IRClassData
followIndex graph@(IRGraph { classes }) index =
    unsafePartial $
        case fromJust $ Seq.index index classes of
        Class cd -> Tuple index cd
        Redirect i -> followIndex graph i

getClassFromGraph :: IRGraph -> Int -> IRClassData
getClassFromGraph graph index = T.snd $ followIndex graph index

mapClasses :: forall a. (Int -> IRClassData -> a) -> IRGraph -> List a
mapClasses f (IRGraph { classes }) = L.concat $ L.mapWithIndex mapper (L.fromFoldable classes)
    where
        mapper _ NoType = L.Nil
        mapper _ (Redirect _) = L.Nil
        mapper i (Class cd) = (f i cd) : L.Nil

mapClassesInSeq :: (Int -> IRClassData -> IRClassData) -> Seq.Seq Entry -> Seq.Seq Entry
mapClassesInSeq f entries =
    Seq.fromFoldable $ L.mapWithIndex entryMapper $ L.fromFoldable entries
    where
        entryMapper i (Class cd) = Class $ f i cd
        entryMapper _ x = x

classesInGraph :: IRGraph -> List (Tuple Int IRClassData)
classesInGraph  = mapClasses Tuple

isArray :: IRType -> Boolean
isArray (IRArray _) = true
isArray _ = false

isClass :: IRType -> Boolean
isClass (IRClass _) = true
isClass _ = false

isMap :: IRType -> Boolean
isMap (IRMap _) = true
isMap _ = false

nullifyNothing :: IRType -> IRType
nullifyNothing IRNothing = IRNull
nullifyNothing x = x

-- FIXME: This should take an IRUnionRep
nullableFromSet :: Set IRType -> Maybe IRType
nullableFromSet s =
    case L.fromFoldable s of
    IRNull : x : L.Nil -> Just x
    x : IRNull : L.Nil -> Just x
    _ -> Nothing

canBeNull :: IRType -> Boolean
canBeNull =
    case _ of
    IRNull -> true
    IRUnion (IRUnionRep { primitives }) -> (Bits.and primitives irUnion_Null) /= 0
    _ -> false

matchingProperties :: forall v. Eq v => Map String v -> Map String v -> Map String v
matchingProperties ma mb = M.fromFoldable $ L.concatMap getFromB (M.toUnfoldable ma)
    where
        getFromB (Tuple k va) =
            case M.lookup k mb of
            Just vb | va == vb -> Tuple k vb : L.Nil
                    | otherwise -> L.Nil
            Nothing -> L.Nil


isMaybeSubtypeOfMaybe :: IRGraph -> Maybe IRType -> Maybe IRType -> Boolean
isMaybeSubtypeOfMaybe _ Nothing Nothing = true
isMaybeSubtypeOfMaybe graph (Just a) (Just b) = isSubtypeOf graph a b
isMaybeSubtypeOfMaybe _ _ _ = false

isSubclassOf :: IRGraph -> Int -> Int -> Boolean
isSubclassOf graph ia ib =
    let IRClassData { properties: pa } = getClassFromGraph graph ia
        IRClassData { properties: pb } = getClassFromGraph graph ib
    in propertiesAreSubset pa pb
    where
        propertiesAreSubset :: Map String IRType -> Map String IRType -> Boolean
        propertiesAreSubset ma mb = all (isInB mb) (M.toUnfoldable ma :: List _)
        isInB mb (Tuple n ta) = maybe false (isSubtypeOf graph ta) (M.lookup n mb)

-- FIXME: generalize with isMaybeSubtypeOfMaybe
isMaybeSubclassOfMaybe :: IRGraph -> Maybe Int -> Maybe Int -> Boolean
isMaybeSubclassOfMaybe _ Nothing Nothing = true
isMaybeSubclassOfMaybe graph (Just a) (Just b) = isSubclassOf graph a b
isMaybeSubclassOfMaybe _ _ _ = false

isSubtypeOf :: IRGraph ->  IRType -> IRType -> Boolean
isSubtypeOf _ IRNothing _ = true
isSubtypeOf graph (IRUnion a) (IRUnion b) =
    let IRUnionRep { primitives: pa, arrayType: aa, classRef: ca, mapType: ma } = a
        IRUnionRep { primitives: pb, arrayType: ab, classRef: cb, mapType: mb } = a
    in
        (Bits.and pa pb) == pa &&
        isMaybeSubtypeOfMaybe graph aa ab &&
        isMaybeSubtypeOfMaybe graph ma mb &&
        isMaybeSubclassOfMaybe graph ca cb
isSubtypeOf graph (IRArray a) (IRArray b) = isSubtypeOf graph a b
isSubtypeOf graph (IRMap a) (IRMap b) = isSubtypeOf graph a b
isSubtypeOf graph (IRClass ia) (IRClass ib) = isSubclassOf graph ia ib
isSubtypeOf _ a b = a == b

regatherClassNames :: IRGraph -> IRGraph
regatherClassNames graph@(IRGraph { classes, toplevels }) =
    -- FIXME: gather names from top levels map, too
    IRGraph { classes: mapClassesInSeq classMapper classes, toplevels }
    where
        newNames = combine $ mapClasses gatherFromClassData graph
        classMapper :: Int -> IRClassData -> IRClassData
        classMapper i (IRClassData { names, properties }) =
            let newNamesForClass = updateInferred (\old -> fromMaybe old $ M.lookup i newNames) names
            in IRClassData { names: newNamesForClass, properties}
        gatherFromClassData :: Int -> IRClassData -> Map Int (Set String)
        gatherFromClassData _ (IRClassData { properties }) =
            combine $ map (\(Tuple n t) -> gatherFromType n t) (M.toUnfoldable properties :: List _)
        combine :: List (Map Int (Set String)) -> Map Int (Set String)
        combine =
            L.foldr (M.unionWith S.union) M.empty
        gatherFromType :: String -> IRType -> Map Int (Set String)
        gatherFromType name t =
            case t of
            IRClass i -> M.singleton i (S.singleton name)
            IRArray a -> gatherFromType (singular name) a
            IRMap m -> gatherFromType (singular name) m
            IRUnion (IRUnionRep { arrayType, classRef, mapType }) ->
                let fromArray = maybe M.empty (gatherFromType name) arrayType
                    fromMap = maybe M.empty (gatherFromType name) mapType
                    fromClass = maybe M.empty (\i -> gatherFromType name $ IRClass i) classRef
                in
                    combine $ (fromArray : fromMap : fromClass : L.Nil)
            _ -> M.empty

regatherUnionNames :: IRGraph -> IRGraph
regatherUnionNames graph@(IRGraph { classes, toplevels }) =
    let newClasses = mapClassesInSeq (const classMapper) classes
        newTopLevels = M.mapWithKey (updateType <<< Given) toplevels
    in
        IRGraph { classes: newClasses, toplevels: newTopLevels }
    where
        classMapper (IRClassData { names, properties }) =
            IRClassData { names, properties: M.mapWithKey (updateType <<< Inferred) properties }
        reassign name names =
            case name of
            Given g -> updateGiven (maybe (S.singleton g) (S.insert g)) names
            Inferred i -> updateInferred (const $ S.singleton i) names
        updateType :: Named String -> IRType -> IRType
        updateType name t =
            case t of
            IRArray a -> IRArray $ updateType name a
            IRMap m -> IRMap $ updateType name m
            IRUnion (IRUnionRep { names, primitives, arrayType, classRef, mapType}) ->
                let newNames = reassign name names
                    singularName = mapToInferred singular name
                    newArrayType = map (updateType singularName) arrayType
                    newMapType = map (updateType singularName) mapType
                in
                    IRUnion $ IRUnionRep { names: newNames, primitives, arrayType: newArrayType, classRef, mapType: newMapType }
            _ -> t

unionToSet :: IRUnionRep -> Set IRType
unionToSet (IRUnionRep { primitives, arrayType, classRef, mapType }) =
    let types1 = addIfSet irUnion_Nothing IRNothing L.Nil
        types2 = addIfSet irUnion_Null IRNull types1
        types3 = addIfSet irUnion_Integer IRInteger types2
        types4 = addIfSet irUnion_Double IRDouble types3
        types5 = addIfSet irUnion_Bool IRBool types4
        types6 = addIfSet irUnion_String IRString types5
        types7 = addIfJust IRArray arrayType types6
        types8 = addIfJust IRClass classRef types7
        types9 = addIfJust IRMap mapType types8
    in
        S.fromFoldable types9
    where
        addIfSet bit t l =
            if (Bits.and bit primitives) == 0 then l else t : l
        addIfJust :: forall a. (a -> IRType) -> Maybe a -> List IRType -> List IRType
        addIfJust c m l =
            case m of
            Just x -> c x : l
            Nothing -> l

filterTypes :: forall a. Ord a => (IRType -> Maybe a) -> IRGraph -> Set a
filterTypes predicate graph@(IRGraph { classes, toplevels }) =
    let fromTopLevels = S.unions $ map filterType $ M.values toplevels
        fromGraph = S.unions $ mapClasses (\_ cd -> filterClass cd) graph
    in
        S.union fromTopLevels fromGraph
    where
        filterClass :: IRClassData -> Set a
        filterClass (IRClassData { properties }) =
            S.unions $ map filterType $ M.values properties
        recurseType t =
            case t of
            IRArray t -> filterType t
            IRMap t -> filterType t
            IRUnion r ->
                S.unions $ S.map filterType $ unionToSet r
            _ -> S.empty
        filterType :: IRType -> Set a
        filterType t =
            let l = recurseType t
            in
                case predicate t of
                Nothing -> l
                Just x -> S.insert x l

emptyUnion :: IRUnionRep
emptyUnion =
    IRUnionRep { names: Inferred $ S.empty, primitives: 0, arrayType: Nothing, classRef: Nothing, mapType: Nothing }
