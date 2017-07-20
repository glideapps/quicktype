module Transformations where

import Prelude
import IRGraph
import IR

import Control.Monad.State.Class (get)
import Data.Filterable (filtered)
import Data.Foldable (all, for_)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.Set as S
import Data.Tuple (Tuple(..))
import Data.Tuple as T

classesSimilar :: IRGraph -> IRClassData -> IRClassData -> Boolean
classesSimilar graph (IRClassData { properties: pa }) (IRClassData { properties: pb }) =
    propertiesSimilar pa pb --||
    --propertiesAreSubset graph pa pb ||
    --propertiesAreSubset graph pb pa

propertiesSimilar :: forall v. Eq v => Map String v -> Map String v -> Boolean
propertiesSimilar pa pb =
    let aInB = M.size $ matchingProperties pa pb
        bInA = M.size $ matchingProperties pb pa
    in
        (aInB * 4 >= (M.size pa) * 3) && (bInA * 4 >= (M.size pb) * 3)

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

replaceSimilarClasses :: IR Unit
replaceSimilarClasses = do
    graph <- get
    let similar = similarClasses graph
    for_ similar unifySetOfClasses
    followRedirections

replaceClassWithMap :: Int -> IR Unit
replaceClassWithMap i = do
    IRClassData { names, properties } <- getClass i
    let types = M.values properties
    t <- L.foldM unifyTypes IRNothing types
    replaceClass i (IRMap t)

makeMaps :: IR Unit
makeMaps = do
    graph <- get
    let mapIndexes = filtered $ mapClasses isMapMapper graph
    for_ mapIndexes \i -> do
        replaceClassWithMap i
    where
        isMapMapper i (IRClassData { names, properties }) =
            let types = M.values properties
                isMap = (L.length types) >= 20 && allEqual types
            in if isMap then Just i else Nothing
        allEqual L.Nil = true
        allEqual (t : ts) = all (eq t) ts
