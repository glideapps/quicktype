module Doc
    ( Doc
    , Renderer
    , Transforms
    , Namer
    , getTopLevels
    , getSingleTopLevel
    , getModuleName
    , getForSingleOrMultipleTopLevels
    , getClasses
    , getClass
    , getUnions
    , getUnionNames
    , getTopLevelNames
    , lookupName
    , lookupClassName
    , lookupUnionName
    , lookupTopLevelName
    , forEachTopLevel_
    , forEachClass_
    , forEachUnion_
    , forEachProperty_
    , combineNames
    , NamingResult
    , transformNames
    , transformPropertyNames
    , simpleNamer
    , noForbidNamer
    , forbidNamer
    , unionNameIntercalated
    , unionIsNotSimpleNullable
    , getTopLevelPlural
    , string
    , line
    , blank
    , indent
    -- Build Doc Unit with monad syntax, then render to string
    , runDoc
    , runRenderer
    , getTypeNameForUnion
    , renderRenderItems
    ) where

import IRGraph (IRClassData(..), IRGraph(..), IRType(..), IRUnionRep(..), Named, classesInGraph, filterTypes, getClassFromGraph, mapUnionM, namedValue, nullableFromUnion, unionToList)
import Prelude

import Control.Monad.RWS (RWS, evalRWS, asks, gets, modify, tell)
import Data.Array as A
import Data.Foldable (for_, any, intercalate)
import Data.FoldableWithIndex (forWithIndex_)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), fromMaybe, maybe, isNothing)
import Data.Sequence (Seq)
import Data.Sequence as Sq
import Data.Set (Set)
import Data.Set as S
import Data.String (Pattern(..), fromCharArray, length, split, toCharArray) as String
import Data.String.Util (times) as String
import Data.Tuple (Tuple(..), fst, snd)
import Utils (sortByKeyM, mapM)

type Renderer =
    { name :: String
    , extension :: String
    , aceMode :: String
    , doc :: Doc Unit
    , transforms :: Transforms
    }

type NamingResult = { name :: String, forbid :: Array String }
type Namer a = a -> Maybe String -> NamingResult

type Transforms =
    { nameForClass :: Namer IRClassData
    , nextName :: String -> String
    , forbiddenNames :: Array String
    , topLevelName :: Namer String
    , unions :: Maybe
        { predicate :: IRUnionRep -> Boolean
        , properName :: Namer (Named (Set String))
        , nameFromTypes :: Namer (Array String)
        }
    }

type DocState = { indent :: Int }

type DocEnv =
    { graph :: IRGraph
    , classNames :: Map Int String
    , unionNames :: Map IRUnionRep String
    , topLevelNames :: Map String String
    , unionSet :: Set IRUnionRep
    }

newtype Doc a = Doc (RWS DocEnv String DocState a)

derive newtype instance functorDoc :: Functor Doc
derive newtype instance applyDoc :: Apply Doc
derive newtype instance applicativeDoc :: Applicative Doc
derive newtype instance bindDoc :: Bind Doc
derive newtype instance monadDoc :: Monad Doc

runRenderer :: Renderer -> IRGraph -> String
runRenderer { doc, transforms } = runDoc doc transforms

runDoc :: forall a. Doc a -> Transforms -> IRGraph -> String
runDoc (Doc w) t graph@(IRGraph { toplevels }) =
    let topLevelTuples = map (\n -> Tuple n n) $ M.keys toplevels
        forbiddenFromStart = S.fromFoldable t.forbiddenNames
        { names: topLevelNames, forbidden: forbiddenAfterTopLevels } = transformNames t.topLevelName t.nextName forbiddenFromStart topLevelTuples
        classes = classesInGraph graph
        { names: classNames, forbidden: forbiddenAfterClasses } = transformNames t.nameForClass t.nextName forbiddenAfterTopLevels classes
        { unionSet, unionNames } = doUnions classNames forbiddenAfterClasses
    in
        evalRWS w { graph, classNames, unionNames, topLevelNames, unionSet } { indent: 0 } # snd
    where
        doUnions :: Map Int String -> Set String -> { unionSet :: Set IRUnionRep, unionNames :: Map IRUnionRep String }
        doUnions classNames forbidden = case t.unions of
            Nothing -> { unionSet: S.empty, unionNames: M.empty }
            Just { predicate, properName, nameFromTypes } ->
                let unionSet = filterTypes (unionPredicate predicate) graph
                    unionNames = (transformNames (unionNamer nameFromTypes properName classNames) t.nextName forbidden $ map (\s -> Tuple s s) $ L.fromFoldable unionSet).names
                in
                    { unionSet, unionNames }

        unionPredicate :: (IRUnionRep -> Boolean) -> IRType -> Maybe IRUnionRep
        unionPredicate p (IRUnion ur) = if p ur then Just ur else Nothing
        unionPredicate _ _ = Nothing

        unionNamer :: Namer (Array String) -> Namer (Named (Set String)) -> Map Int String -> Namer IRUnionRep
        unionNamer nameFromTypes properName classNames union@(IRUnionRep { names }) =
            if namedValue names == S.empty then
                let typeStrings = map (typeNameForUnion graph classNames) $ A.sort $ A.fromFoldable $ unionToList union
                in
                    nameFromTypes typeStrings
            else
                properName names

transformNames :: forall a b. Ord a => Ord b => Namer b -> (String -> String) -> Set String -> List (Tuple a b) -> { names :: Map a String, forbidden :: Set String }
transformNames legalize otherize illegalNames names =
    process S.empty illegalNames M.empty names
    where
        makeName :: b -> NamingResult -> Set String -> Set String -> NamingResult
        makeName name result@{ name: tryName, forbid } forbiddenInScope forbiddenForAll =
            if S.member tryName forbiddenInScope || any (\x -> S.member x forbiddenForAll) forbid then
                makeName name (legalize name (Just $ otherize tryName)) forbiddenInScope forbiddenForAll
            else
                result
        process :: Set String -> Set String -> Map a String -> List (Tuple a b) -> { names :: Map a String, forbidden :: Set String }
        process forbiddenInScope forbiddenForAll mapSoFar l =
            case l of
            L.Nil -> { names: mapSoFar, forbidden: forbiddenForAll }
            (Tuple identifier inputs) : rest ->
                let { name, forbid } = makeName inputs (legalize inputs Nothing) forbiddenInScope forbiddenForAll
                    newForbiddenInScope = S.insert name forbiddenInScope
                    newForbiddenForAll = S.union (S.fromFoldable forbid) forbiddenForAll
                    newMap = M.insert identifier name mapSoFar
                in
                    process newForbiddenInScope newForbiddenForAll newMap rest

transformPropertyNames :: Namer String -> (String -> String) -> Array String -> Map String IRType -> Map String String
transformPropertyNames legalize otherize illegalNamesArray properties =
    let illegalNames = S.fromFoldable illegalNamesArray
    in
        _.names $ transformNames legalize otherize illegalNames $ map (\n -> Tuple n n) $ M.keys properties

forbidNamer :: forall a. Ord a => (a -> String) -> (String -> Array String) -> Namer a
forbidNamer namer forbidder _ (Just name) = { name, forbid: forbidder name }
forbidNamer namer forbidder x Nothing =
    let name = namer x
    in { name, forbid: forbidder name }

simpleNamer :: forall a. Ord a => (a -> String) -> Namer a
simpleNamer namer = forbidNamer namer A.singleton

noForbidNamer :: forall a. Ord a => (a -> String) -> Namer a
noForbidNamer namer = forbidNamer namer (const [])

typeNameForUnion :: IRGraph -> Map Int String -> IRType -> String
typeNameForUnion graph classNames = case _ of
    IRNothing -> "anything"
    IRNull -> "null"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> typeNameForUnion graph classNames a <> "_array"
    IRClass i -> lookupName i classNames
    IRMap t -> typeNameForUnion graph classNames t <> "_map"
    IRUnion _ -> "union"

unionNameIntercalated :: (String -> String) -> String -> Array String -> String
unionNameIntercalated nameStyle orString names =
    names
    <#> nameStyle
    # intercalate orString

unionIsNotSimpleNullable :: IRUnionRep -> Boolean
unionIsNotSimpleNullable ur = isNothing $ nullableFromUnion ur

getTypeNameForUnion :: IRType -> Doc String
getTypeNameForUnion typ = do
  g <- getGraph
  classNames <- getClassNames
  pure $ typeNameForUnion g classNames typ

getGraph :: Doc IRGraph
getGraph = Doc (asks _.graph)

getTopLevels :: Doc (Map String IRType)
getTopLevels = do
    IRGraph { toplevels } <- getGraph
    pure toplevels

getSingleTopLevel :: Doc (Maybe (Tuple String IRType))
getSingleTopLevel = do
    topLevels <- getTopLevels
    case M.toUnfoldable topLevels :: List (Tuple String IRType) of
        t : L.Nil -> pure $ Just t
        _ -> pure Nothing

getModuleName :: (String -> String) -> Doc String
getModuleName nameStyler = do
    single <- getSingleTopLevel
    pure $ maybe "QuickType" (fst >>> nameStyler) single

getForSingleOrMultipleTopLevels :: forall a. a -> a -> Doc a
getForSingleOrMultipleTopLevels forSingle forMultiple = do
    single <- getSingleTopLevel
    pure $ maybe forMultiple (const forSingle) single

getClassNames :: Doc (Map Int String)
getClassNames = Doc (asks _.classNames)

getUnions :: Doc (List IRUnionRep)
getUnions = do
    unsorted <- M.keys <$> getUnionNames
    sortByKeyM lookupUnionName unsorted

getUnionNames :: Doc (Map IRUnionRep String)
getUnionNames = Doc (asks _.unionNames)

getUnionSet :: Doc (Set IRUnionRep)
getUnionSet = Doc (asks _.unionSet)

getTopLevelNames :: Doc (Map String String)
getTopLevelNames = Doc (asks _.topLevelNames)

getClasses :: Doc (L.List (Tuple Int IRClassData))
getClasses = do
    unsorted <- classesInGraph <$> getGraph
    sortByKeyM (\t -> lookupClassName (fst t)) unsorted

getClass :: Int -> Doc IRClassData
getClass i = do
  graph <- getGraph
  pure $ getClassFromGraph graph i

lookupName :: forall a. Ord a => a -> Map a String -> String
lookupName original nameMap =
    fromMaybe "NAME_NOT_PROCESSED" $ M.lookup original nameMap

lookupClassName :: Int -> Doc String
lookupClassName i = do
    classNames <- getClassNames
    pure $ lookupName i classNames

lookupUnionName :: IRUnionRep -> Doc String
lookupUnionName s = do
    unionNames <- getUnionNames
    pure $ lookupName s unionNames

lookupTopLevelName :: String -> Doc String
lookupTopLevelName n = do
    topLevelNames <- getTopLevelNames
    pure $ lookupName n topLevelNames

type TopLevelIterator = String -> IRType -> Doc Unit
type ClassIterator = String -> Map String IRType -> Doc Unit
type UnionIterator = String -> IRUnionRep -> Doc Unit

callTopLevelIterator :: TopLevelIterator -> String -> IRType -> Doc Unit
callTopLevelIterator f topLevelNameGiven topLevelType = do
    topLevelName <- lookupTopLevelName topLevelNameGiven
    f topLevelName topLevelType

forEachTopLevel_ :: TopLevelIterator -> Doc Unit
forEachTopLevel_ f = do
    topLevels <- getTopLevels
    for_ (M.toUnfoldable topLevels :: List (Tuple String IRType)) \(Tuple topLevelNameGiven topLevelType) ->
        callTopLevelIterator f topLevelNameGiven topLevelType

callClassIterator :: ClassIterator -> Int -> IRClassData -> Doc Unit
callClassIterator f i (IRClassData { properties }) = do
    className <- lookupClassName i
    f className properties

forEachClass_ :: ClassIterator -> Doc Unit
forEachClass_ f = do
    classes <- getClasses
    for_ classes \(Tuple i cd) ->
        callClassIterator f i cd

callUnionIterator :: UnionIterator -> IRUnionRep -> Doc Unit
callUnionIterator f ur = do
    unionName <- lookupUnionName ur
    f unionName ur

forEachUnion_ :: UnionIterator -> Doc Unit
forEachUnion_ f = do
    unions <- getUnions
    for_ unions \ur ->
        callUnionIterator f ur

forEachProperty_ :: Map String IRType -> Map String String -> (String -> IRType -> String -> Boolean -> Doc Unit) -> Doc Unit
forEachProperty_ properties propertyNames f =
    let propertyArray = M.toUnfoldable properties :: Array (Tuple String IRType)
        lastIndex = A.length propertyArray - 1
    in
        forWithIndex_ propertyArray \i (Tuple pname ptype) -> do
            let fieldName = lookupName pname propertyNames
            f pname ptype fieldName (i == lastIndex)

getTopLevelPlural :: Doc String
getTopLevelPlural = getForSingleOrMultipleTopLevels "" "s"

-- Given a potentially multi-line string, render each line at the current indent level
line :: String -> Doc Unit
line s = do
    indent' <- Doc (gets _.indent)
    let whitespace = String.times "    " indent'
    let lines = String.split (String.Pattern "\n") s
    for_ lines \l -> do
        string whitespace
        string l
        string "\n"  

string :: String -> Doc Unit
string = Doc <<< tell

blank :: Doc Unit
blank = string "\n"

indent :: forall a. Doc a -> Doc a
indent doc = do
    Doc $ modify (\s -> { indent: s.indent + 1 })
    a <- doc
    Doc $ modify (\s -> { indent: s.indent - 1 })
    pure a

combineNames :: Named (Set String) -> String
combineNames names =
    let s = namedValue names
    in case L.fromFoldable s of
    L.Nil -> "NONAME"
    name : L.Nil -> name
    firstName : rest ->
        let a = String.toCharArray firstName
            { p, s } = L.foldl prefixSuffixFolder { p: a, s: A.reverse a } rest
            prefix = if A.length p > 2 then p else []
            suffix = if A.length s > 2 then A.reverse s else []
            name = String.fromCharArray $ A.concat [prefix, suffix]
        in
            if String.length name > 2 then
                name
            else
                firstName

commonPrefix :: Array Char -> Array Char -> Array Char
commonPrefix a b =
    let l = A.length $ A.takeWhile id $ A.zipWith eq a b
    in A.take l a

prefixSuffixFolder :: { p :: Array Char, s :: Array Char } -> String -> { p :: Array Char, s :: Array Char }
prefixSuffixFolder { p, s } x =
    let a = String.toCharArray x
        newP = commonPrefix p a
        newS = commonPrefix s (A.reverse a)
    in { p: newP, s: newS }

data RenderItem
    = RenderTopLevel String IRType
    | RenderClass Int IRClassData
    | RenderUnion IRUnionRep

derive instance eqRenderItem :: Eq RenderItem
derive instance ordRenderItem :: Ord RenderItem

sortRenderItems :: Array RenderItem -> Doc (Array RenderItem)
sortRenderItems startItems = do
    reversedSorted <- sortStep (Sq.fromFoldable startItems) L.Nil (S.fromFoldable startItems)
    pure $ A.reverse $ A.fromFoldable reversedSorted
    where
        expandUnion :: IRUnionRep -> Doc (List RenderItem)
        expandUnion ur = do
            -- `mapUnionM` gives us the same order we use in `callUnionIterator`.
            -- That's not always the same property language backends use, however.
            mapped <- mapUnionM expandType ur
            pure $ L.concat mapped

        expandType :: IRType -> Doc (List RenderItem)
        expandType (IRClass i) = do
            cd <- getClass i
            pure $ L.singleton $ RenderClass i cd
        expandType (IRUnion ur) = do
            unionSet <- getUnionSet
            if S.member ur unionSet
                then
                    pure $ L.singleton $ RenderUnion ur
                else
                    expandUnion ur

        expandType (IRArray a) = expandType a
        expandType (IRMap m) = expandType m
        expandType _ = pure L.Nil

        expand :: RenderItem -> Doc (List RenderItem)
        expand (RenderTopLevel _ t) =
            expandType t
        expand (RenderClass _ (IRClassData { properties })) = do
            -- We're using `toUnfoldable` instead of `values` because
            -- that's the same order we iterate over in `forEachProperty_`.
            -- It happens to be alphabetical, but we shouldn't rely on
            -- that.
            mapped <- mapM expandType $ map snd $ M.toUnfoldable properties
            pure $ L.concat mapped
        expand (RenderUnion ur) =
            expandUnion ur

        filterItems :: Set RenderItem -> List RenderItem -> Seq RenderItem -> { newItems :: Seq RenderItem, newExpandedSet :: Set RenderItem }
        filterItems set L.Nil filtered =
            { newItems: filtered, newExpandedSet: set }
        filterItems set (item : otherItems) filtered =
            if S.member item set then
                filterItems set otherItems filtered
            else
                filterItems (S.insert item set) otherItems (Sq.snoc filtered item)

        sortStep :: Seq RenderItem -> List RenderItem -> Set RenderItem -> Doc (List RenderItem)
        sortStep queue soFar expandedSet =
            case Sq.uncons queue of
            Nothing ->
                pure $ soFar
            Just (Tuple item queueRest) -> do
                expandedItems <- expand item
                let { newItems, newExpandedSet } = filterItems expandedSet expandedItems Sq.empty
                let newSoFar = item : soFar
                let newQueue = Sq.append newItems queueRest
                sortStep newQueue newSoFar newExpandedSet

getRenderItems :: Doc (Array RenderItem)
getRenderItems = do
    topLevels <- map (\(Tuple n t) -> RenderTopLevel n t) <$> M.toUnfoldable <$> getTopLevels
    sortRenderItems topLevels

renderRenderItems :: Doc Unit -> Maybe TopLevelIterator -> ClassIterator -> Maybe UnionIterator -> Doc Unit
renderRenderItems inBetweener topLevelRenderer classRenderer unionRenderer = do
    renderItems <- L.fromFoldable <$> getRenderItems
    renderLoop false renderItems
    where
        renderLoop :: Boolean -> List RenderItem -> Doc Unit
        renderLoop _ L.Nil = pure unit
        renderLoop needInBetween (item : rest) =
            case item of
                RenderTopLevel n t ->
                    case topLevelRenderer of
                    Nothing -> renderLoop needInBetween rest
                    Just f -> do
                        when needInBetween inBetweener
                        callTopLevelIterator f n t
                        renderLoop true rest
                RenderClass i cd -> do
                    when needInBetween inBetweener
                    callClassIterator classRenderer i cd
                    renderLoop true rest
                RenderUnion ur ->
                    case unionRenderer of
                    Nothing -> renderLoop needInBetween rest
                    Just f -> do
                        when needInBetween inBetweener
                        callUnionIterator f ur
                        renderLoop true rest
