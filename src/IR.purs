module IR
    ( IR
    , unifySetOfClasses
    , followRedirections
    , getClass
    , addClass
    , addTopLevel
    , replaceClass
    , unifyTypes
    , unifyMultipleTypes
    , execIR
    , runIR
    ) where

import IRGraph
import Prelude

import Control.Monad.State (State, execState, runState)
import Control.Monad.State.Class (get, put)
import Data.Foldable (foldM, for_)
import Data.Int.Bits as Bits
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Sequence as Seq
import Data.Set (Set)
import Data.Set as S
import Data.Tuple (Tuple(..))
import Data.Tuple as T
import Utils (lookupOrDefault, mapM, mapMapM)

type IR = State IRGraph

execIR :: forall a. IR a -> IRGraph
execIR ir = execState ir emptyGraph

runIR :: forall a. IR a -> Tuple a IRGraph
runIR ir = runState ir emptyGraph

addTopLevel :: String -> IRType -> IR Unit
addTopLevel name toplevel = do
    IRGraph { classes, toplevels } <- get
    let newTopLevels = M.insert name toplevel toplevels
    put $ IRGraph { classes, toplevels: newTopLevels }

addClassWithIndex :: IRClassData -> IR (Tuple Int IRType)
addClassWithIndex classData = do
    IRGraph { classes, toplevels } <- get
    case Seq.elemIndex (Class classData) classes of
        Nothing -> do
            let index = Seq.length classes
            put $ IRGraph { classes: Seq.snoc classes (Class classData), toplevels }
            pure $ Tuple index (IRClass index)
        Just index -> pure $ Tuple index (IRClass index)

addClass :: IRClassData -> IR IRType
addClass classData = T.snd <$> addClassWithIndex classData

redirectClass :: Int -> Int -> IR Unit
redirectClass from to = do
    graph@(IRGraph { classes: c1, toplevels }) <- get
    let realTo = T.fst $ followIndex graph to
    if from == realTo
        then pure unit
        else do
            let c2 = Seq.replace (Redirect realTo) from c1
            put $ IRGraph { classes: c2, toplevels }

deleteClass :: Int -> IR Unit
deleteClass i = do
    IRGraph { classes, toplevels } <- get
    let newClasses = Seq.replace NoType i classes
    put $ IRGraph { classes: newClasses, toplevels }

getClass :: Int -> IR IRClassData
getClass index = do
    graph <- get
    pure $ getClassFromGraph graph index

combineClasses :: Int -> Int -> IRClassData -> IR Int
combineClasses ia ib combined = do
    IRGraph { classes } <- get
    Tuple newIndex t <- addClassWithIndex combined
    redirectClass ia newIndex
    redirectClass ib newIndex
    pure newIndex

-- FIXME: this is ugly and inefficient
unionWithDefault :: forall k v. Ord k => (v -> v -> IR v) -> v -> Map k v -> Map k v -> IR (Map k v)
unionWithDefault unifier default m1 m2 =
    let allKeys = L.fromFoldable $ S.union (S.fromFoldable $ M.keys m1) (S.fromFoldable $ M.keys m2)
        valueFor k = unifier (lookupOrDefault default k m1) (lookupOrDefault default k m2)
        keyMapper k = Tuple k <$> valueFor k
    in M.fromFoldable <$> mapM keyMapper allKeys

unifyClassDatas :: IRClassData -> IRClassData -> IR IRClassData
unifyClassDatas (IRClassData { names: na, properties: pa }) (IRClassData { names: nb, properties: pb }) = do
    properties <- unionWithDefault unifyTypesWithNull IRNothing pa pb
    pure $ IRClassData { names: unifyNamed S.union na nb, properties }

unifyClassRefs :: Int -> Int -> IR Int
unifyClassRefs ia ib =
    if ia == ib
    then pure ia
    else do
        a <- getClass ia
        b <- getClass ib
        unified <- unifyClassDatas a b
        combineClasses ia ib unified

unifyMaybes :: Maybe IRType -> Maybe IRType -> IR IRType
unifyMaybes Nothing Nothing = pure IRNothing
unifyMaybes (Just a) Nothing = pure a
unifyMaybes Nothing (Just b) = pure b
unifyMaybes (Just a) (Just b) = unifyTypes a b

unifyTypes :: IRType -> IRType -> IR IRType
unifyTypes IRNothing x = pure x
unifyTypes x IRNothing = pure x
unifyTypes IRInteger IRDouble = pure IRDouble
unifyTypes IRDouble IRInteger = pure IRDouble
unifyTypes (IRArray a) (IRArray b) = IRArray <$> unifyTypes a b
unifyTypes a@(IRClass ia) (IRClass ib) = do
    unified <- unifyClassRefs ia ib
    pure $ IRClass unified
unifyTypes (IRMap a) (IRMap b) = IRMap <$> unifyTypes a b
unifyTypes (IRUnion a) b = IRUnion <$> unifyWithUnion a b
unifyTypes a (IRUnion b) = IRUnion <$> unifyWithUnion b a
unifyTypes a b | a == b = pure a
               | otherwise = do
                    u1 <- unifyWithUnion emptyUnion a
                    u2 <- unifyWithUnion u1 b
                    pure $ IRUnion u2

unifyMultipleTypes :: List IRType -> IR IRType
unifyMultipleTypes = L.foldM unifyTypes IRNothing

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

            let folder cd1 i2 = getClass i2 >>= unifyClassDatas cd1
            combined <- foldM folder firstClass rest

            Tuple newIndex _ <- addClassWithIndex combined
            for_ indexes \i -> redirectClass i newIndex

followRedirections :: IR Unit
followRedirections = do
    graph <- get
    replaceTypes (replaceClassesInType \i -> Just $ IRClass $ T.fst $ followIndex graph i)

updateClasses :: (IRClassData -> IR IRClassData) -> (IRType -> IR IRType) -> IR Unit
updateClasses classUpdater typeUpdater = do
    IRGraph { classes, toplevels } <- get
    newClasses <- mapM mapper $ L.fromFoldable classes
    newToplevels <- mapMapM (\_ -> typeUpdater) toplevels
    put $ IRGraph { classes: Seq.fromFoldable newClasses, toplevels: newToplevels }
    where
        mapper entry =
            case entry of
            Class cd -> Class <$> classUpdater cd
            _ -> pure entry

unifyWithUnion :: IRUnionRep -> IRType -> IR IRUnionRep
unifyWithUnion u@(IRUnionRep { names, primitives, arrayType, classRef, mapType }) t =
    case t of
    IRNothing -> pure u
    IRNull -> addBit irUnion_Null
    IRInteger -> addBit irUnion_Integer
    IRDouble -> addBit irUnion_Double
    IRBool -> addBit irUnion_Bool
    IRString -> addBit irUnion_String
    IRArray ta -> do
        unified <- doTypes ta arrayType
        pure $ IRUnionRep { names, primitives, arrayType: unified, classRef, mapType }
    IRClass ti -> do
        unified <- doClasses ti classRef
        pure $ IRUnionRep { names, primitives, arrayType, classRef: unified, mapType }
    IRMap tm -> do
        unified <- doTypes tm mapType
        pure $ IRUnionRep { names, primitives, arrayType, classRef, mapType: unified }
    IRUnion (IRUnionRep { names: na, primitives: pb, arrayType: ab, classRef: cb, mapType: mb }) -> do
        let p = Bits.or primitives pb
        a <- doMaybeTypes arrayType ab
        c <- doMaybeClasses classRef cb
        m <- doMaybeTypes mapType mb
        pure $ IRUnionRep { names: unifyNamed S.union names na, primitives: p, arrayType: a, classRef: c, mapType: m }
    where
        addBit b =
            pure $ IRUnionRep { names, primitives: Bits.or b primitives, arrayType, classRef, mapType }
        doWithUnifier :: forall a. (a -> a -> IR a) -> a -> Maybe a -> IR (Maybe a)
        doWithUnifier unify a mb =
            case mb of
            Just b -> do
                unified <- unify a b
                pure $ Just unified
            Nothing ->
                pure $ Just a
        doTypes = doWithUnifier unifyTypes
        doClasses = doWithUnifier unifyClassRefs
        doMaybe :: forall a. (a -> Maybe a -> IR (Maybe a)) -> Maybe a -> Maybe a -> IR (Maybe a)
        doMaybe doer ma mb =
            case ma of
            Just a -> doer a mb
            Nothing -> pure mb
        doMaybeTypes = doMaybe doTypes
        doMaybeClasses = doMaybe doClasses

replaceClassesInType :: (Int -> Maybe IRType) -> IRType -> IR IRType
replaceClassesInType replacer t =
    case t of
    IRClass i -> pure $ fromMaybe t $ replacer i
    IRArray a -> do
        replaced <- replace a
        pure $ IRArray replaced
    IRMap m -> do
        replaced <- replace m
        pure $ IRMap replaced
    IRUnion (IRUnionRep { names, primitives, arrayType, classRef, mapType }) -> do
        a <- replaceInMaybe arrayType
        m <- replaceInMaybe mapType
        IRUnion <$> doClassRef names primitives a classRef m
    _ -> pure t
    where
        replace = replaceClassesInType replacer
        replaceInMaybe :: (Maybe IRType) -> IR (Maybe IRType)
        replaceInMaybe m =
            case m of
            Just x -> Just <$> replace x
            Nothing -> pure Nothing
        doClassRef :: Named (Set String) -> Int -> Maybe IRType -> Maybe Int -> Maybe IRType -> IR IRUnionRep
        doClassRef names primitives arrayType classRef mapType =
            case classRef of
            Just i ->
                case replacer i of
                Just replacement ->
                    unifyWithUnion (IRUnionRep { names, primitives, arrayType, classRef: Nothing, mapType }) replacement
                Nothing -> pure $ IRUnionRep { names, primitives, arrayType, classRef, mapType }
            _ -> pure $ IRUnionRep { names, primitives, arrayType, classRef, mapType }

replaceTypes :: (IRType -> IR IRType) -> IR Unit
replaceTypes typeUpdater =
    updateClasses classUpdater typeUpdater
    where
        classUpdater (IRClassData { names, properties }) = do
            newProperties <- mapMapM (\_ t -> typeUpdater t) properties
            pure $ IRClassData { names, properties: newProperties }

replaceClass :: Int -> IRType -> IR Unit
replaceClass from to = do
    replaceTypes $ (replaceClassesInType \i -> if i == from then Just to else Nothing)
    deleteClass from
