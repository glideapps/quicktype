module IR
    ( IR
    , unifySetOfClasses
    , followRedirections
    , getClass
    , addClass
    , replaceClass
    , unifyTypes
    , runIR
    , mapM
    ) where

import Prelude

import IRGraph

import Control.Monad.State (State, execState)
import Control.Monad.State.Class (get, put)
import Data.Foldable (for_, foldM)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.Sequence as Seq
import Data.Set (Set)
import Data.Set as S
import Data.Tuple (Tuple(..))
import Data.Tuple as T

type IR = State IRGraph

runIR :: forall a. IR a -> IRGraph
runIR ir = execState ir emptyGraph

addClassWithIndex :: IRClassData -> IR (Tuple Int IRType)
addClassWithIndex classData = do
    IRGraph { classes } <- get
    case Seq.elemIndex (Class classData) classes of
        Nothing -> do
            let index = Seq.length classes
            put $ IRGraph { classes: Seq.snoc classes (Class classData) }
            pure $ Tuple index (IRClass index)
        Just index -> pure $ Tuple index (IRClass index)

addClass :: IRClassData -> IR IRType
addClass classData = T.snd <$> addClassWithIndex classData

redirectClass :: Int -> Int -> IR Unit
redirectClass from to = do
    graph@(IRGraph { classes: c1 }) <- get
    let realTo = T.fst $ followIndex graph to
    if from == realTo
        then pure unit
        else do
            let c2 = Seq.replace (Redirect realTo) from c1
            put $ IRGraph { classes: c2 }

deleteClass :: Int -> IR Unit
deleteClass i = do
    IRGraph { classes } <- get
    let newClasses = Seq.replace NoType i classes
    put $ IRGraph { classes: newClasses }

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

-- FIXME: doesn't really belong here
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
    let { maybeArray: arrayA, maybeClass: classA, maybeMap: mapA, rest: sa } = decomposeTypeSet sa
    let { maybeArray: arrayB, maybeClass: classB, maybeMap: mapB, rest: sb } = decomposeTypeSet sb
    unifiedArray <- unifyMaybes arrayA arrayB
    unifiedClasses <- unifyMaybes classA classB
    unifiedMap <- unifyMaybes mapA mapB
    pure $ S.unions [sa, sb, setFromType unifiedArray, setFromType unifiedClasses, setFromType unifiedMap]

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
unifyTypes (IRMap a) (IRMap b) = IRMap <$> unifyTypes a b
unifyTypes (IRUnion a) (IRUnion b) = IRUnion <$> unifyUnion a b
unifyTypes (IRUnion a) b = IRUnion <$> unifyUnion a (S.singleton b)
unifyTypes a (IRUnion b) = IRUnion <$> unifyUnion (S.singleton a) b
unifyTypes a b | a == b = pure a
               | otherwise = pure $ IRUnion (S.fromFoldable [a, b])

unifyTypesWithNull :: IRType -> IRType -> IR IRType
unifyTypesWithNull IRNothing IRNothing = pure IRNothing
unifyTypesWithNull a b = unifyTypes (nullifyNothing a) (nullifyNothing b)

unifySetOfClasses :: Set Int -> IR Unit
unifySetOfClasses indexes =
    case L.fromFoldable indexes of
        L.Nil -> pure unit
        _ : L.Nil -> pure unit
        first : rest ->  do
            firstClass <- getClass first

            let folder cd1 i2 = getClass i2 >>= unifyClasses cd1
            combined <- foldM folder firstClass rest

            Tuple newIndex _ <- addClassWithIndex combined
            for_ indexes \i -> redirectClass i newIndex

followRedirections :: IR Unit
followRedirections = do
    graph <- get
    replaceClasses \i -> Just $ IRClass $ T.fst $ followIndex graph i

updateClasses :: (IRClassData -> IR IRClassData) -> IR Unit
updateClasses updater = do
    IRGraph { classes } <- get
    newList <- mapM mapper $ L.fromFoldable classes
    put $ IRGraph { classes: Seq.fromFoldable newList }
    where
        mapper entry =
            case entry of
            Class cd -> Class <$> updater cd
            _ -> pure entry

replaceClasses :: (Int -> Maybe IRType) -> IR Unit
replaceClasses replacer = do
    updateClasses updater
    where
        updater (IRClassData { names, properties }) =
            let newProperties = M.mapWithKey (\_ t -> replaceClassesInType replacer t) properties
            in pure $ IRClassData { names, properties: newProperties }

replaceClass :: Int -> IRType -> IR Unit
replaceClass from to = do
    replaceClasses (\i -> if i == from then Just to else Nothing)
    deleteClass from
