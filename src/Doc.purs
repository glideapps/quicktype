module Doc
    ( Doc
    , getGraph
    , getClasses
    , getClass
    , string
    , line
    , lines
    , words
    , blank
    , indent
    -- Build Doc Unit with monad syntax, then render to string
    , runDoc
    ) where

import Prelude

import Control.Monad.RWS (RWS, evalRWS, asks, gets, modify, tell)
import Data.Foldable (intercalate, sequence_)
import Data.List as L
import Data.String as String
import Data.Tuple (snd)
import IR as IR

type DocState = { indent :: Int }
type DocEnv = { graph :: IR.IRGraph }
newtype Doc a = Doc (RWS DocEnv String DocState a)

derive newtype instance functorDoc :: Functor Doc
derive newtype instance applyDoc :: Apply Doc
derive newtype instance applicativeDoc :: Applicative Doc
derive newtype instance bindDoc :: Bind Doc
derive newtype instance monadDoc :: Monad Doc
    
runDoc :: forall a. Doc a -> IR.IRGraph -> String
runDoc (Doc w) graph = evalRWS w { graph } { indent: 0 } # snd

getGraph :: Doc IR.IRGraph
getGraph = Doc (asks _.graph)

getClasses :: Doc (L.List IR.IRClassData)
getClasses = IR.classesInGraph <$> getGraph

getClass :: Int -> Doc IR.IRClassData
getClass i = do
  graph <- getGraph
  pure $ IR.getClassFromGraph graph i

line ::  Doc Unit -> Doc Unit
line r = do
    indent <- Doc (gets _.indent)
    string $ times "\t" indent
    r
    string "\n"

-- Given a potentially multi-line string, render each line at the current indent level
lines :: String -> Doc Unit
lines =
  String.split (String.Pattern "\n")
  >>> map String.trim
  >>> map string
  >>> map line
  >>> sequence_

-- Cannot make this work any other way!
times :: String -> Int -> String
times s n | n < 1 = ""
times s 1 = s
times s n = s <> times s (n - 1)

string :: String -> Doc Unit
string = Doc <<< tell

blank :: Doc Unit
blank = string "\n"

words :: Array String -> Doc Unit
words = string <<< intercalate " "

indent :: forall a. Doc a -> Doc a
indent doc = do
    Doc $ modify (\s -> { indent: s.indent + 1 })
    a <- doc
    Doc $ modify (\s -> { indent: s.indent - 1 })
    pure a