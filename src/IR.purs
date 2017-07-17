module IR where

import Control.Monad.State
import Control.Monad.State.Class
import Prelude

import Data.Either (Either(..), isLeft)
import Data.Foldable (find, all, any, for_, foldM)
import Data.List (List(..), concatMap, length, mapWithIndex, singleton, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromJust)
import Data.Set (Set, empty, fromFoldable)
import Data.Set as S
import Data.Tuple (Tuple(..))
import Data.Tuple as T
import Partial.Unsafe (unsafePartial)

newtype IRGraph = IRGraph { classes :: List (Either IRClassData Int) }

newtype IRClassData = IRClassData { names :: Set String, properties :: Map String IRType }

makeClass :: String -> Map String IRType -> IRClassData
makeClass name properties =
    IRClassData { names: S.singleton name, properties }

emptyGraph :: IRGraph
emptyGraph = IRGraph { classes: L.Nil }

addClassWithIndex :: IRClassData -> State IRGraph (Tuple Int IRType)
addClassWithIndex classData =
    do
        IRGraph { classes } <- get
        let index = L.length classes
        put (IRGraph { classes: (L.snoc classes (Left classData)) })
        pure $ Tuple index (IRClass index)

addClass :: IRClassData -> State IRGraph IRType
addClass classData =
    do
        Tuple _ t <- addClassWithIndex classData
        pure t

redirectClass :: Int -> Int -> State IRGraph Unit
redirectClass from to =
    do
        (IRGraph { classes: c1 }) <- get
        let c2 = unsafePartial $ fromJust $ L.updateAt from (Right to) c1
        put (IRGraph { classes: c2 })

getClassFromGraph :: IRGraph -> Int -> IRClassData
getClassFromGraph graph@(IRGraph { classes }) index =
    case unsafePartial $ fromJust $ L.index classes index of
    Left cd -> cd
    Right i -> getClassFromGraph graph i

getClass :: Int -> State IRGraph IRClassData
getClass index =
    do
        graph <- get
        pure $ getClassFromGraph graph index

combineClasses :: Int -> Int -> IRClassData -> State IRGraph IRType
combineClasses ia ib combined =
    do
        IRGraph { classes } <- get
        let newIndex = L.length classes
        t <- addClass combined
        redirectClass ia newIndex
        redirectClass ib newIndex
        pure t

mapClasses :: forall a. (Int -> IRClassData -> a) -> IRGraph -> List a
mapClasses f (IRGraph { classes }) =
    L.concat $ L.mapWithIndex mapper classes
    where
        mapper i e =
            case e of
            Left cd -> L.singleton $ f i cd
            Right _ -> L.Nil

classesInGraph :: IRGraph -> List IRClassData
classesInGraph  =
    mapClasses (\i cd -> cd)

data IRType
    = IRNothing
    | IRNull
    | IRInteger
    | IRDouble
    | IRBool
    | IRString
    | IRArray IRType
    | IRClass Int
    | IRUnion (Set IRType)

lookupOrDefault :: forall k v. Ord k => v -> k -> Map k v -> v
lookupOrDefault default key m =
    case M.lookup key m of
    Nothing -> default
    Just x -> x

removeElement :: forall a. Ord a => (a -> Boolean) -> S.Set a -> { element :: Maybe a, rest :: S.Set a }
removeElement p s =
    let element = (find p s)
    in
        case element of
            Just x -> { element: element, rest: S.delete x s }
            Nothing -> { element: element, rest: s }

mapM :: forall a b. (a -> State IRGraph b) -> List a -> State IRGraph (List b)
mapM _ L.Nil = pure L.Nil
mapM f (x : xs) =
    do
        ys <- mapM f xs
        y <- f x
        pure $ y : ys

-- FIXME: this is ugly and inefficient
unionWithDefault :: forall k v. Ord k => (v -> v -> State IRGraph v) -> v -> Map k v -> Map k v -> State IRGraph (Map k v)
unionWithDefault unifier default m1 m2 =
    let allKeys = L.fromFoldable $ S.union (S.fromFoldable $ M.keys m1) (S.fromFoldable $ M.keys m2)
        valueFor k = unifier (lookupOrDefault default k m1) (lookupOrDefault default k m2)
        keyMapper k =
            do
                v <- valueFor k
                pure $ Tuple k v
    in
        do
            kvps <- mapM keyMapper allKeys
            pure $ M.fromFoldable kvps

isArray :: IRType -> Boolean
isArray (IRArray _) = true
isArray _ = false

isClass :: IRType -> Boolean
isClass (IRClass _) = true
isClass _ = false

decomposeTypeSet :: S.Set IRType -> { maybeArray :: Maybe IRType, maybeClass :: Maybe IRType, rest :: S.Set IRType }
decomposeTypeSet s =
    let { element: maybeArray, rest: rest } = removeElement isArray s
        { element: maybeClass, rest: rest } = removeElement isClass rest
    in
        { maybeArray, maybeClass, rest }

setFromType :: IRType -> S.Set IRType
setFromType IRNothing = S.empty
setFromType x = S.singleton x

zeroClass :: IRClassData
zeroClass = IRClassData { names: S.empty, properties: M.empty }

unifyClasses :: IRClassData -> IRClassData -> State IRGraph IRClassData
unifyClasses (IRClassData { names: na, properties: pa }) (IRClassData { names: nb, properties: pb }) =
    do
        properties <- unionWithDefault unifyTypesWithNull IRNothing pa pb
        pure $ IRClassData { names: (S.union na nb), properties: properties }

unifyMaybes :: Maybe IRType -> Maybe IRType -> State IRGraph IRType
unifyMaybes Nothing Nothing = pure IRNothing
unifyMaybes (Just a) Nothing = pure a
unifyMaybes Nothing (Just b) = pure b
unifyMaybes (Just a) (Just b) = unifyTypes a b

unifyUnion :: S.Set IRType -> S.Set IRType -> State IRGraph (S.Set IRType)
unifyUnion sa sb =
    do
        let { maybeArray: arrayA, maybeClass: classA, rest: sa } = decomposeTypeSet sa
        let { maybeArray: arrayB, maybeClass: classB, rest: sb } = decomposeTypeSet sb
        unifiedArray <- unifyMaybes arrayA arrayB
        unifiedClasses <- unifyMaybes classA classB
        pure $ S.unions [sa, sb, setFromType unifiedArray, setFromType unifiedClasses]

unifyTypes :: IRType -> IRType -> State IRGraph IRType
unifyTypes IRNothing x = pure x
unifyTypes x IRNothing = pure x
unifyTypes (IRArray a) (IRArray b) =
    do
        unified <- unifyTypes a b
        pure $ IRArray unified
unifyTypes (IRClass ia) (IRClass ib) =
    do
        a <- getClass ia
        b <- getClass ib
        unified <- unifyClasses a b
        combineClasses ia ib unified
unifyTypes (IRUnion a) (IRUnion b) =
    do
        unified <- unifyUnion a b 
        pure $ IRUnion unified
unifyTypes (IRUnion a) b =
    do
        unified <- unifyUnion a (S.singleton b)
        pure $ IRUnion unified
unifyTypes a (IRUnion b) =
    do
        unified <- unifyUnion (S.singleton a) b
        pure $ IRUnion unified
unifyTypes a b =
    do
        pure $ if a == b then a else IRUnion (S.fromFoldable [a, b])

nullifyNothing :: IRType -> IRType
nullifyNothing IRNothing = IRNull
nullifyNothing x = x

unifyTypesWithNull :: IRType -> IRType -> State IRGraph IRType
unifyTypesWithNull IRNothing IRNothing = pure IRNothing
unifyTypesWithNull a b = unifyTypes (nullifyNothing a) (nullifyNothing b)

matchingProperties :: forall v. Eq v => Map String v -> Map String v -> Map String v
matchingProperties ma mb =
    M.fromFoldable (L.concatMap getFromB (M.toUnfoldable ma))
    where
        getFromB (Tuple k va) =
            case M.lookup k mb of
            Just vb -> if va == vb then Tuple k vb : L.Nil else L.Nil
            Nothing -> L.Nil

propertiesSimilar :: forall v. Eq v => Map String v -> Map String v -> Boolean
propertiesSimilar pa pb =
    let aInB = M.size $ matchingProperties pa pb
        bInA = M.size $ matchingProperties pb pa
    in
        (aInB * 4 >= (M.size pa) * 3) && (bInA * 4 >= (M.size pb) * 3)

isMaybeSubtypeOfMaybe :: IRGraph -> Maybe IRType -> Maybe IRType -> Boolean
isMaybeSubtypeOfMaybe _ Nothing Nothing = true
isMaybeSubtypeOfMaybe graph (Just a) (Just b) = isSubtypeOf graph a b
isMaybeSubtypeOfMaybe _ _ _ = false

isSubtypeOf :: IRGraph ->  IRType -> IRType -> Boolean
isSubtypeOf _ IRNothing _ = true
isSubtypeOf graph (IRUnion sa) (IRUnion sb) =
    all (\ta -> any (isSubtypeOf graph ta) sb) sa
isSubtypeOf graph (IRArray a) (IRArray b) =
    isSubtypeOf graph a b
isSubtypeOf graph (IRClass ia) (IRClass ib) =
    let IRClassData { names: _, properties: pa } = getClassFromGraph graph ia
        IRClassData { names: _, properties: pb } = getClassFromGraph graph ib
    in
        propertiesAreSubset graph pa pb
isSubtypeOf _ a b = a == b

propertiesAreSubset :: IRGraph -> Map String IRType -> Map String IRType -> Boolean
propertiesAreSubset graph ma mb =
    all isInB (M.toUnfoldable ma :: List _)
    where
        isInB (Tuple n ta) =
            case M.lookup n mb of
            Nothing -> false
            Just tb -> isSubtypeOf graph ta tb

classesSimilar :: IRGraph -> IRClassData -> IRClassData -> Boolean
classesSimilar graph (IRClassData { names: _, properties: pa }) (IRClassData { names: _, properties: pb }) =
    propertiesSimilar pa pb --||
    --propertiesAreSubset graph pa pb ||
    --propertiesAreSubset graph pb pa

similarClasses :: IRGraph -> Set (Set Int)
similarClasses graph@(IRGraph { classes }) =
    accumulate (mapClasses Tuple graph)
    where
        accumulate :: List (Tuple Int IRClassData) -> Set (Set Int)
        accumulate L.Nil = S.empty
        accumulate ((Tuple i thisClass) : rest) =
            let { yes: similar, no: others } = L.partition (isSimilar thisClass) rest
                recursiveResult = accumulate others
            in
                if L.length similar == 0 then
                    recursiveResult
                else
                    let similarSet = S.fromFoldable (i : (map T.fst similar))
                    in
                        S.insert similarSet recursiveResult
        isSimilar cd1 (Tuple _ cd2) =
            classesSimilar graph cd1 cd2

unifySetOfClasses :: Set Int -> (State IRGraph Unit)
unifySetOfClasses indexes =
    do
        combined <- foldM folder zeroClass indexes
        Tuple newIndex _ <- addClassWithIndex combined
        for_ indexes \i -> do
            redirectClass i newIndex
    where
        folder cd1 i2 =
            do
                cd2 <- getClass i2
                unifyClasses cd1 cd2

replaceSimilarClasses :: State IRGraph Unit
replaceSimilarClasses =
    do
        graph <- get
        let similar = similarClasses graph
        for_ similar unifySetOfClasses

combineNames :: S.Set String -> String
combineNames s =
    case L.fromFoldable s of
    L.Nil -> "NONAME"
    n : _ -> n

instance eqIRType :: Eq IRType where
    eq IRNothing IRNothing = true
    eq IRNull IRNull = true
    eq IRInteger IRInteger = true
    eq IRDouble IRDouble = true
    eq IRBool IRBool = true
    eq IRString IRString = true
    eq (IRArray a) (IRArray b) = a == b
    eq (IRClass a) (IRClass b) = a == b
    eq (IRUnion a) (IRUnion b) = a == b
    eq _ _ = false

instance ordIRType :: Ord IRType where
    compare IRNothing IRNothing = EQ
    compare IRNothing _ = LT
    compare _ IRNothing = GT
    compare IRNull IRNull = EQ
    compare IRNull _ = LT
    compare _ IRNull = GT
    compare IRInteger IRInteger = EQ
    compare IRInteger _ = LT
    compare _ IRInteger = GT
    compare IRDouble IRDouble = EQ
    compare IRDouble _ = LT
    compare _ IRDouble = GT
    compare IRBool IRBool = EQ
    compare IRBool _ = LT
    compare _ IRBool = GT
    compare IRString IRString = EQ
    compare IRString _ = LT
    compare _ IRString = GT
    compare (IRArray a) (IRArray b) = compare a b
    compare (IRArray _) _ = LT
    compare _ (IRArray _) = GT
    compare (IRClass a) (IRClass b) = compare a b
    compare (IRClass _) _ = LT
    compare _ (IRClass _) = GT
    compare (IRUnion a) (IRUnion b) = compare a b

instance eqIRClassData :: Eq IRClassData where
    eq (IRClassData { names: na, properties: pa }) (IRClassData { names: nb, properties: pb }) = na == nb && pa == pb

instance ordIRClassData :: Ord IRClassData where
    compare (IRClassData { names: na, properties: pa }) (IRClassData { names: nb, properties: pb }) =
        case compare na nb of
        EQ -> compare pa pb
        x -> x
