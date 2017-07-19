module IR where

import Prelude

import Data.Either (Either(..), either)
import Data.Maybe (Maybe(..), fromJust, maybe)
import Data.Foldable (find, all, any, for_, foldM)

import Data.List as L
import Data.List (List, (:))

import Data.Map as M
import Data.Map (Map)

import Data.Sequence as Seq

import Data.Set as S
import Data.Set (Set)

import Data.Tuple as T
import Data.Tuple (Tuple(..))

import Control.Monad.State (State, execState)
import Control.Monad.State.Class (get, put)

import Partial.Unsafe (unsafePartial)

type IR = State IRGraph
newtype IRGraph = IRGraph { classes :: Seq.Seq (Either IRClassData Int) }
newtype IRClassData = IRClassData { names :: Set String, properties :: Map String IRType }

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

derive instance eqIRType :: Eq IRType
derive instance ordIRType :: Ord IRType
derive instance eqIRClassData :: Eq IRClassData

runIR :: forall a. IR a -> IRGraph
runIR ir = execState ir emptyGraph

makeClass :: String -> Map String IRType -> IRClassData
makeClass name properties = IRClassData { names: S.singleton name, properties }

emptyGraph :: IRGraph
emptyGraph = IRGraph { classes: Seq.empty }

addClassWithIndex :: IRClassData -> IR (Tuple Int IRType)
addClassWithIndex classData = do
    IRGraph { classes } <- get
    case Seq.elemIndex (Left classData) classes of
        Nothing -> do
            let index = Seq.length classes
            put $ IRGraph { classes: Seq.snoc classes (Left classData) }
            pure $ Tuple index (IRClass index)
        Just index -> pure $ Tuple index (IRClass index)

addClass :: IRClassData -> IR IRType
addClass classData = T.snd <$> addClassWithIndex classData

followIndex :: IRGraph -> Int -> Tuple Int IRClassData
followIndex graph@(IRGraph { classes }) index =
    case unsafePartial $ fromJust $ Seq.index index classes of
    Left cd -> Tuple index cd
    Right i -> followIndex graph i

redirectClass :: Int -> Int -> IR Unit
redirectClass from to = do
    graph@(IRGraph { classes: c1 }) <- get
    let realTo = T.fst $ followIndex graph to
    if from == realTo
        then pure unit
        else do
            let c2 = Seq.replace (Right realTo) from c1
            put $ IRGraph { classes: c2 }

getClassFromGraph :: IRGraph -> Int -> IRClassData
getClassFromGraph graph index = T.snd $ followIndex graph index

getClass :: Int -> IR IRClassData
getClass index = do
    graph <- get
    pure $ getClassFromGraph graph index

combineClasses :: Int -> Int -> IRClassData -> IR IRType
combineClasses ia ib combined = do
    IRGraph { classes } <- get
    Tuple newIndex t <- addClassWithIndex combined
    -- FIXME: could newIndex be ia or ib?
    redirectClass ia newIndex
    redirectClass ib newIndex
    pure t

mapClasses :: forall a. (Int -> IRClassData -> a) -> IRGraph -> List a
mapClasses f (IRGraph { classes }) = L.concat $ L.mapWithIndex mapper (L.fromFoldable classes)
    where mapper i = either (L.singleton <<< f i) (const L.Nil)

classesInGraph :: IRGraph -> List IRClassData
classesInGraph  = mapClasses (const id)

lookupOrDefault :: forall k v. Ord k => v -> k -> Map k v -> v
lookupOrDefault default key m = maybe default id $ M.lookup key m

removeElement :: forall a. Ord a => (a -> Boolean) -> S.Set a -> { element :: Maybe a, rest :: S.Set a }
removeElement p s = { element, rest: maybe s (\x -> S.delete x s) element }
    where element = find p s 

mapM :: forall a b. (a -> IR b) -> List a -> IR (List b)
mapM _ L.Nil = pure L.Nil
mapM f (x : xs) = L.Cons <$> f x <*> mapM f xs

-- FIXME: this is ugly and inefficient
unionWithDefault :: forall k v. Ord k => (v -> v -> IR v) -> v -> Map k v -> Map k v -> IR (Map k v)
unionWithDefault unifier default m1 m2 =
    let allKeys = L.fromFoldable $ S.union (S.fromFoldable $ M.keys m1) (S.fromFoldable $ M.keys m2)
        valueFor k = unifier (lookupOrDefault default k m1) (lookupOrDefault default k m2)
        keyMapper k = Tuple k <$> valueFor k
    in M.fromFoldable <$> mapM keyMapper allKeys

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
    in { maybeArray, maybeClass, rest }

setFromType :: IRType -> S.Set IRType
setFromType IRNothing = S.empty
setFromType x = S.singleton x

unifyClasses :: IRClassData -> IRClassData -> IR IRClassData
unifyClasses (IRClassData { names: na, properties: pa }) (IRClassData { names: nb, properties: pb }) = do
    properties <- unionWithDefault unifyTypesWithNull IRNothing pa pb
    pure $ IRClassData { names: S.union na nb, properties }

unifyMaybes :: Maybe IRType -> Maybe IRType -> IR IRType
unifyMaybes Nothing Nothing = pure IRNothing
unifyMaybes (Just a) Nothing = pure a
unifyMaybes Nothing (Just b) = pure b
unifyMaybes (Just a) (Just b) = unifyTypes a b

unifyUnion :: S.Set IRType -> S.Set IRType -> IR (S.Set IRType)
unifyUnion sa sb = do
    let { maybeArray: arrayA, maybeClass: classA, rest: sa } = decomposeTypeSet sa
    let { maybeArray: arrayB, maybeClass: classB, rest: sb } = decomposeTypeSet sb
    unifiedArray <- unifyMaybes arrayA arrayB
    unifiedClasses <- unifyMaybes classA classB
    pure $ S.unions [sa, sb, setFromType unifiedArray, setFromType unifiedClasses]

unifyTypes :: IRType -> IRType -> IR IRType
unifyTypes IRNothing x = pure x
unifyTypes x IRNothing = pure x
unifyTypes (IRArray a) (IRArray b) = IRArray <$> unifyTypes a b
unifyTypes a@(IRClass ia) (IRClass ib) =
    if ia == ib
    then pure a
    else do
        a <- getClass ia
        b <- getClass ib
        unified <- unifyClasses a b
        combineClasses ia ib unified
unifyTypes (IRUnion a) (IRUnion b) = IRUnion <$> unifyUnion a b
unifyTypes (IRUnion a) b = IRUnion <$> unifyUnion a (S.singleton b)
unifyTypes a (IRUnion b) = IRUnion <$> unifyUnion (S.singleton a) b
unifyTypes a b | a == b = pure a
               | otherwise = pure $ IRUnion (S.fromFoldable [a, b])

nullifyNothing :: IRType -> IRType
nullifyNothing IRNothing = IRNull
nullifyNothing x = x

unifyTypesWithNull :: IRType -> IRType -> IR IRType
unifyTypesWithNull IRNothing IRNothing = pure IRNothing
unifyTypesWithNull a b = unifyTypes (nullifyNothing a) (nullifyNothing b)

matchingProperties :: forall v. Eq v => Map String v -> Map String v -> Map String v
matchingProperties ma mb = M.fromFoldable $ L.concatMap getFromB (M.toUnfoldable ma)
    where
        getFromB (Tuple k va) =
            case M.lookup k mb of
            Just vb | va == vb -> Tuple k vb : L.Nil
                    | otherwise -> L.Nil
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
isSubtypeOf graph (IRUnion sa) (IRUnion sb) = all (\ta -> any (isSubtypeOf graph ta) sb) sa
isSubtypeOf graph (IRArray a) (IRArray b) = isSubtypeOf graph a b
isSubtypeOf graph (IRClass ia) (IRClass ib) =
    let IRClassData { properties: pa } = getClassFromGraph graph ia
        IRClassData { properties: pb } = getClassFromGraph graph ib
    in propertiesAreSubset graph pa pb
isSubtypeOf _ a b = a == b

propertiesAreSubset :: IRGraph -> Map String IRType -> Map String IRType -> Boolean
propertiesAreSubset graph ma mb = all isInB (M.toUnfoldable ma :: List _)
    where isInB (Tuple n ta) = maybe false (isSubtypeOf graph ta) (M.lookup n mb)

classesSimilar :: IRGraph -> IRClassData -> IRClassData -> Boolean
classesSimilar graph (IRClassData { properties: pa }) (IRClassData { properties: pb }) =
    propertiesSimilar pa pb --||
    --propertiesAreSubset graph pa pb ||
    --propertiesAreSubset graph pb pa

similarClasses :: IRGraph -> Set (Set Int)
similarClasses graph = accumulate (mapClasses Tuple graph)
    where
        accumulate :: List (Tuple Int IRClassData) -> Set (Set Int)
        accumulate L.Nil = S.empty
        accumulate (Tuple i thisClass : rest) =
            let { yes: similar, no: others } = L.partition (isSimilar thisClass) rest
                recursiveResult = accumulate others
            in case similar of
                L.Nil -> recursiveResult
                _ ->
                    let similarSet = S.fromFoldable (i : map T.fst similar)
                    in S.insert similarSet recursiveResult
        
        isSimilar cd1 (Tuple _ cd2) = classesSimilar graph cd1 cd2

unifySetOfClasses :: Set Int -> (IR Unit)
unifySetOfClasses indexes =
    case L.fromFoldable indexes of
        L.Nil -> pure unit
        _ : L.Nil -> pure unit
        first : rest ->  do
            firstClass <- getClass first

            let folder cd1 i2 = getClass i2 >>= unifyClasses cd1
            combined <- foldM folder firstClass rest

            Tuple newIndex _ <- addClassWithIndex combined
            for_ indexes \i ->  redirectClass i newIndex

replaceSimilarClasses :: IR Unit
replaceSimilarClasses = do
    graph <- get
    let similar = similarClasses graph
    for_ similar unifySetOfClasses

combineNames :: S.Set String -> String
combineNames s = case L.fromFoldable s of
    L.Nil -> "NONAME"
    n : _ -> n
