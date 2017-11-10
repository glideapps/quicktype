module IR
    ( IR
    , unifySetOfClasses
    , followRedirections
    , normalizeGraphOrder
    , getClass
    , addClass
    , addTopLevel
    , replaceClass
    , addPlaceholder
    , replacePlaceholder
    , replaceNoInformationWithAnyType
    , unifyTypes
    , unifyMultipleTypes
    , execIR
    , runIR
    ) where

import Prelude

import Control.Monad.Except (ExceptT, runExceptT)
import Control.Monad.State (State, runState, evalState)
import Control.Monad.State.Class (get, put)
import Data.Either (Either(..))
import Data.Foldable (class Foldable, foldM, for_)
import Data.Int.Bits as Bits
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromJust, fromMaybe)
import Data.Sequence as Seq
import Data.Set (Set)
import Data.Set as S
import Data.Tuple (Tuple(..), fst, snd)
import Data.Tuple as T
import IRGraph (Entry(..), IRClassData(..), IREnumData(..), IRGraph(..), IRType(..), IRUnionRep(..), Named, emptyGraph, emptyUnion, followIndex, getClassFromGraph, irUnion_Bool, irUnion_Double, irUnion_Integer, irUnion_Null, irUnion_String, unifyNamed)
import Partial.Unsafe (unsafePartial)
import Utils (lookupOrDefault, mapM, mapMapM, mapMaybeM, sortByKey)

type IR = ExceptT String (State IRGraph)

execIR :: forall a. IR a -> Either String IRGraph
execIR ir = snd <$> runIR ir

runIR :: forall a. IR a ->  Either String (Tuple a IRGraph)
runIR ir =
    case runState (runExceptT ir) emptyGraph of
        Tuple (Right a) s -> Right (Tuple a s)
        Tuple (Left error) _ -> Left error

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

addPlaceholder :: IR Int
addPlaceholder = do
    IRGraph { classes, toplevels } <- get
    let index = Seq.length classes
    put $ IRGraph { classes: Seq.snoc classes NoType, toplevels }
    pure index

replacePlaceholder :: Int -> IRClassData -> IR Unit
replacePlaceholder i classData = do
    IRGraph { classes, toplevels } <- get
    -- FIXME: assert it is a placeholder!
    let newClasses = Seq.replace (Class classData) i classes
    put $ IRGraph { classes: newClasses, toplevels}

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
    properties <- unionWithDefault unifyTypesWithNull IRNoInformation pa pb
    pure $ IRClassData { names: unifyNamed S.union na nb, properties }
    where
        unifyTypesWithNull :: IRType -> IRType -> IR IRType
        unifyTypesWithNull IRNoInformation IRNoInformation = pure IRNoInformation
        unifyTypesWithNull a b = unifyTypes (nullifyNoInformation a) (nullifyNoInformation b)

        nullifyNoInformation :: IRType -> IRType
        nullifyNoInformation IRNoInformation = IRNull
        nullifyNoInformation x = x

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
unifyMaybes Nothing Nothing = pure IRNoInformation
unifyMaybes (Just a) Nothing = pure a
unifyMaybes Nothing (Just b) = pure b
unifyMaybes (Just a) (Just b) = unifyTypes a b

unifyTypes :: IRType -> IRType -> IR IRType
unifyTypes IRNoInformation x = pure x
unifyTypes x IRNoInformation = pure x
unifyTypes IRAnyType x = pure IRAnyType
unifyTypes x IRAnyType = pure IRAnyType
unifyTypes IRInteger IRDouble = pure IRDouble
unifyTypes IRDouble IRInteger = pure IRDouble
unifyTypes (IRArray a) (IRArray b) = IRArray <$> unifyTypes a b
unifyTypes a@(IRClass ia) (IRClass ib) = do
    unified <- unifyClassRefs ia ib
    pure $ IRClass unified
unifyTypes (IRMap a) (IRMap b) = IRMap <$> unifyTypes a b
unifyTypes (IRUnion a) b = unifyWithUnion a b
unifyTypes a (IRUnion b) = unifyWithUnion b a
unifyTypes a b | a == b = pure a
               | otherwise = do
                    u1 <- unifyWithUnion emptyUnion a
                    unifyTypes u1 b

unifyMultipleTypes :: forall f. Foldable f => f IRType -> IR IRType
unifyMultipleTypes = foldM unifyTypes IRNoInformation

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

unifyWithUnion :: IRUnionRep -> IRType -> IR IRType
unifyWithUnion u@(IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData }) t =
    case t of
    IRNoInformation -> pure  $ IRUnion u
    IRAnyType -> pure IRAnyType
    IRNull -> addBit irUnion_Null
    IRInteger -> addBit irUnion_Integer
    IRDouble -> addBit irUnion_Double
    IRBool -> addBit irUnion_Bool
    IRString ->
        pure $ IRUnion $ IRUnionRep { names, primitives: Bits.or irUnion_String primitives, arrayType, classRef, mapType, enumData: Nothing }
    IRArray ta -> do
        unified <- doTypes ta arrayType
        pure $ IRUnion $ IRUnionRep { names, primitives, arrayType: unified, classRef, mapType, enumData }
    IRClass ti -> do
        unified <- doClasses ti classRef
        pure $ IRUnion $ IRUnionRep { names, primitives, arrayType, classRef: unified, mapType, enumData }
    IRMap tm -> do
        unified <- doTypes tm mapType
        pure $ IRUnion $ IRUnionRep { names, primitives, arrayType, classRef, mapType: unified, enumData }
    IREnum te ->
        if (Bits.and irUnion_String primitives) == 0 then
            pure $ IRUnion $ IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData: unifyEnumData enumData $ Just te }
        else
            pure $ IRUnion u
    IRUnion (IRUnionRep { names: na, primitives: pb, arrayType: ab, classRef: cb, mapType: mb, enumData: eb }) -> do
        let p = Bits.or primitives pb
        a <- doMaybeTypes arrayType ab
        c <- doMaybeClasses classRef cb
        m <- doMaybeTypes mapType mb
        let e = if (Bits.and irUnion_String p) == 0 then unifyEnumData enumData eb else Nothing
        pure $ IRUnion $ IRUnionRep { names: unifyNamed S.union names na, primitives: p, arrayType: a, classRef: c, mapType: m, enumData: e }
    where
        unifyEnumData :: Maybe IREnumData -> Maybe IREnumData -> Maybe IREnumData
        unifyEnumData (Just (IREnumData { names: n1, cases: v1 })) (Just (IREnumData { names: n2, cases: v2 })) =
            Just (IREnumData { names: unifyNamed S.union n1 n2, cases: S.union v1 v2 })
        unifyEnumData e1 Nothing = e1
        unifyEnumData Nothing e2 = e2
        addBit b =
            pure $ IRUnion $ IRUnionRep { names, primitives: Bits.or b primitives, arrayType, classRef, mapType, enumData }
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
    IRUnion (IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData }) -> do
        a <- replaceInMaybe arrayType
        m <- replaceInMaybe mapType
        doClassRef names primitives a classRef m enumData
    _ -> pure t
    where
        replace = replaceClassesInType replacer
        replaceInMaybe :: (Maybe IRType) -> IR (Maybe IRType)
        replaceInMaybe m =
            case m of
            Just x -> Just <$> replace x
            Nothing -> pure Nothing
        doClassRef :: Named (Set String) -> Int -> Maybe IRType -> Maybe Int -> Maybe IRType -> Maybe IREnumData -> IR IRType
        doClassRef names primitives arrayType classRef mapType enumData =
            case classRef of
            Just i ->
                case replacer i of
                Just replacement ->
                    unifyWithUnion (IRUnionRep { names, primitives, arrayType, classRef: Nothing, mapType, enumData }) replacement
                Nothing -> pure $ IRUnion $ IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData }
            _ -> pure $ IRUnion $ IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData }

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

replaceNoInformationWithAnyType :: IR Unit
replaceNoInformationWithAnyType = do
    replaceTypes replacer
    where
        replacer :: IRType -> IR IRType
        replacer IRNoInformation = pure IRAnyType
        replacer (IRArray a) = IRArray <$> replacer a
        replacer (IRMap m) = IRMap <$> replacer m
        replacer (IRUnion (IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData })) = do
            arrayType <- mapM replacer arrayType
            mapType <- mapM replacer mapType
            pure $ IRUnion $ IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData }
        replacer t = pure t

-- This maps from old class index to new class index and new class data
type ClassMapper = State (Map Int (Tuple Int (Maybe IRClassData)))

normalizeGraphOrder :: IRGraph -> IRGraph
normalizeGraphOrder graph@(IRGraph { toplevels }) =
    evalState work M.empty
    where
        -- When we encounter a class we first check whether we've seen
        -- it before (Right), or whether it's new (Left).  In the Left
        -- case, we get a new index for the class, and the index is added
        -- to the map.
        registerClass :: Int -> ClassMapper (Either Int Int)
        registerClass oldIndex = do
            m <- get
            case M.lookup oldIndex m of
                Just (Tuple newIndex _) -> pure $ Right newIndex
                Nothing -> do
                    let newIndex = M.size m
                    put $ M.insert oldIndex (Tuple newIndex Nothing) m
                    pure $ Left newIndex
        
        -- After we're done processing a new class, we update the
        -- entry in the map with its IRClassData.
        setClass :: Int -> IRClassData -> ClassMapper Unit
        setClass oldIndex cd = do
            m <- get
            let Tuple newIndex _ = unsafePartial $ fromJust $ M.lookup oldIndex m
            put $ M.insert oldIndex (Tuple newIndex $ Just cd) m

        sortMap :: Map String IRType -> List (Tuple String IRType)
        sortMap m = sortByKey fst $ M.toUnfoldable m

        addClassesFromClass :: Int -> ClassMapper Int
        addClassesFromClass oldIndex = do
            reg <- registerClass oldIndex
            case reg of
                Left newIndex -> do
                    let IRClassData { names, properties } = getClassFromGraph graph oldIndex
                    let sorted = sortMap properties
                    newProperties <- M.fromFoldable <$> mapM (\(Tuple n t) -> Tuple n <$> addClasses t) sorted
                    let cd = IRClassData { names, properties: newProperties }
                    setClass oldIndex cd
                    pure newIndex
                Right newIndex -> pure newIndex

        addClasses :: IRType -> ClassMapper IRType
        addClasses (IRClass i) = IRClass <$> addClassesFromClass i
        addClasses (IRArray t) = IRArray <$> addClasses t
        addClasses (IRMap m) = IRMap <$> addClasses m
        addClasses (IRUnion (IRUnionRep { names, primitives, arrayType, classRef, mapType, enumData })) = do
            newArrayType <- mapMaybeM addClasses arrayType
            newClassRef <- mapMaybeM addClassesFromClass classRef
            newMapType <- mapMaybeM addClasses mapType
            pure $ IRUnion $ IRUnionRep { names, primitives, arrayType: newArrayType, classRef: newClassRef, mapType: newMapType, enumData }
        addClasses t = pure t

        dejustifyClassMapEntry (Tuple i mcd) = Tuple i $ unsafePartial $ fromJust mcd

        work :: ClassMapper IRGraph
        work = do
            let sortedToplevels = sortMap toplevels
            newToplevels <- mapM (\(Tuple name t) -> Tuple name <$> addClasses t) sortedToplevels
            classMap <- get
            let reverseClassMap = M.fromFoldable $ map dejustifyClassMapEntry $ M.values classMap
            let numClasses = M.size reverseClassMap
            let classIndexRange = if numClasses == 0 then L.Nil else L.range 0 (numClasses - 1)
            let newClasses = map (\i -> Class $ unsafePartial $ fromJust $ M.lookup i reverseClassMap) classIndexRange
            pure $ IRGraph { classes: Seq.fromFoldable newClasses, toplevels: M.fromFoldable newToplevels }
